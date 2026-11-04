import type { Request, Response } from "express";
import type pg from "pg";
import type { Db } from "./db.js";
import { log } from "./logger.js";

/**
 * Live schedule updates over Server-Sent Events (SSE).
 *
 * Why SSE: updates flow one way, from the server to visitors and programmers;
 * clients never push over this channel (writes go through the REST API), so SSE's
 * plain HTTP, automatic reconnect and built-in Last-Event-ID fit better than WebSockets.
 *
 * Ordering guarantee: change ids are assigned AND committed in order. publishChange takes
 * a transaction-scoped advisory lock before inserting, so a transaction holding id N
 * commits before id N+1 is handed out. Without this, id 7 could commit before id 6 and a
 * client reconnecting with Last-Event-ID 7 would silently miss 6.
 *
 * Recovery: every change is persisted in change_events. On reconnect the browser sends
 * Last-Event-ID (or ?lastEventId= for a manual reconnect); the server replays rows with a
 * larger id. Live events that arrive while a client's replay is running are buffered and
 * flushed afterwards, so each client sees ids strictly increasing with no duplicates.
 * A client more than REPLAY_LIMIT events behind receives `resync` and reloads a snapshot.
 *
 * Fan-out across API instances uses PostgreSQL LISTEN/NOTIFY: the NOTIFY is sent in
 * the same transaction as the change, so subscribers only hear about committed changes.
 */

export const CHANNEL = "reel_events";
const REPLAY_LIMIT = 500;
const HEARTBEAT_MS = 25_000;
const CHANGE_LOCK_KEY = 436_2026; // arbitrary constant for pg_advisory_xact_lock

export interface ChangeEvent {
  id: number;
  occurredAt: string;
  type: string;
  screeningId: string | null;
  roomId: string | null;
  payload: unknown;
}

interface ChangeRow {
  id: number;
  occurred_at: Date;
  type: string;
  screening_id: string | null;
  room_id: string | null;
  payload: unknown;
}

interface ClientState {
  replaying: boolean;
  buffered: ChangeEvent[];
  lastSent: number;
}

const toEvent = (r: ChangeRow): ChangeEvent => ({
  id: r.id,
  occurredAt: r.occurred_at.toISOString(),
  type: r.type,
  screeningId: r.screening_id,
  roomId: r.room_id,
  payload: r.payload,
});

/** Record a change inside the caller's transaction and queue a NOTIFY for commit time. */
export async function publishChange(
  client: pg.PoolClient,
  change: { type: string; screeningId: string | null; roomId: string | null; payload: unknown },
): Promise<number> {
  // Held until COMMIT/ROLLBACK: serialises id assignment with commit order (see above).
  await client.query("SELECT pg_advisory_xact_lock($1)", [CHANGE_LOCK_KEY]);
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO change_events (type, screening_id, room_id, payload) VALUES ($1, $2, $3, $4) RETURNING id`,
    [change.type, change.screeningId, change.roomId, JSON.stringify(change.payload)],
  );
  const id = rows[0]!.id;
  await client.query("SELECT pg_notify($1, $2)", [CHANNEL, String(id)]);
  return id;
}

export class EventHub {
  private readonly clients = new Map<Response, ClientState>();
  private listener: pg.PoolClient | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  /** Relays run one at a time so frames leave in notification (= commit) order. */
  private relayChain: Promise<void> = Promise.resolve();

  constructor(private readonly db: Db) {}

  get connectedClients(): number {
    return this.clients.size;
  }

  async start(): Promise<void> {
    this.listener = await this.db.connect();
    this.listener.on("notification", (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      const id = Number(msg.payload);
      this.relayChain = this.relayChain.then(() => this.relay(id));
    });
    await this.listener.query(`LISTEN ${CHANNEL}`);
    this.heartbeat = setInterval(() => {
      for (const res of this.clients.keys()) res.write(": keep-alive\n\n");
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const res of this.clients.keys()) res.end();
    this.clients.clear();
    await this.relayChain.catch(() => {});
    if (this.listener) {
      await this.listener.query(`UNLISTEN ${CHANNEL}`).catch(() => {});
      this.listener.release();
      this.listener = undefined;
    }
  }

  private send(res: Response, state: ClientState, e: ChangeEvent): void {
    if (e.id <= state.lastSent) return; // already delivered (e.g. by replay)
    res.write(formatEvent(e));
    state.lastSent = e.id;
  }

  private async relay(id: number): Promise<void> {
    try {
      const { rows } = await this.db.query<ChangeRow>("SELECT * FROM change_events WHERE id = $1", [id]);
      const row = rows[0];
      if (!row) return;
      const e = toEvent(row);
      for (const [res, state] of this.clients) {
        if (state.replaying) state.buffered.push(e);
        else this.send(res, state, e);
      }
    } catch (err) {
      log.warn("sse_relay_failed", { id, err: String(err) });
    }
  }

  private async latestId(): Promise<number> {
    const { rows } = await this.db.query<{ max: number | null }>("SELECT max(id)::int AS max FROM change_events");
    return rows[0]?.max ?? 0;
  }

  /** GET /api/events */
  handler = async (req: Request, res: Response): Promise<void> => {
    const lastHeader = req.get("last-event-id") ?? (typeof req.query.lastEventId === "string" ? req.query.lastEventId : undefined);
    const lastId = lastHeader !== undefined && /^\d+$/.test(lastHeader) ? Number(lastHeader) : undefined;

    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 3000\n\n");

    // Subscribe first (buffering live events), then replay, then flush the buffer.
    const state: ClientState = { replaying: true, buffered: [], lastSent: lastId ?? 0 };
    this.clients.set(res, state);
    req.on("close", () => this.clients.delete(res));

    try {
      if (lastId !== undefined) {
        const { rows } = await this.db.query<ChangeRow>(
          "SELECT * FROM change_events WHERE id > $1 ORDER BY id LIMIT $2",
          [lastId, REPLAY_LIMIT + 1],
        );
        if (rows.length > REPLAY_LIMIT) {
          // Too far behind: move the client's cursor to "now" and ask it to reload a snapshot.
          state.lastSent = await this.latestId();
          res.write(`id: ${state.lastSent}\nevent: resync\ndata: {"reason":"too_far_behind"}\n\n`);
        } else {
          for (const row of rows) this.send(res, state, toEvent(row));
        }
      } else {
        // A fresh client learns where the log ends; the id: line makes the browser's own
        // reconnect send Last-Event-ID even if no change arrives before a disconnect.
        state.lastSent = await this.latestId();
        res.write(`id: ${state.lastSent}\nevent: ready\ndata: ${JSON.stringify({ latestEventId: state.lastSent })}\n\n`);
      }
    } finally {
      for (const e of state.buffered.sort((a, b) => a.id - b.id)) this.send(res, state, e);
      state.buffered = [];
      state.replaying = false;
    }
  };
}

export function formatEvent(e: ChangeEvent): string {
  return `id: ${e.id}\nevent: change\ndata: ${JSON.stringify(e)}\n\n`;
}
