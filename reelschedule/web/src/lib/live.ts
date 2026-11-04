import { useEffect, useRef, useState } from "react";
import { apiUrl } from "./api";
import { setDataVersion } from "./freshness";
import type { ChangeEvent } from "./types";

/**
 * Live updates over Server-Sent Events.
 *
 * - The browser's EventSource reconnects on its own and sends Last-Event-ID, so the
 *   server replays whatever was missed while disconnected.
 * - If the connection is closed for good (server restart returned an error, laptop slept),
 *   we reopen it ourselves with backoff and pass ?lastEventId= so replay still works.
 * - Events are deduplicated by id: an event that arrives twice is applied once.
 * - A `resync` event (client too far behind) or a cursor-less reconnect means
 *   "reload everything", which the caller does by refetching its queries.
 */

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

/** Remembers recently applied event ids so replays and retries are applied once. */
export class EventDeduper {
  private readonly seen = new Set<number>();
  private readonly order: number[] = [];
  cursor: number | null = null;

  constructor(private readonly limit = 1000) {}

  /** True the first time an id is seen. */
  accept(id: number): boolean {
    this.advance(id);
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > this.limit) this.seen.delete(this.order.shift()!);
    return true;
  }

  advance(id: number): void {
    if (Number.isFinite(id)) this.cursor = Math.max(this.cursor ?? 0, id);
  }
}

export function eventsUrl(cursor: number | null): string {
  return apiUrl(cursor === null ? "/api/events" : `/api/events?lastEventId=${cursor}`);
}

export function backoffMs(attempt: number, random = Math.random): number {
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(random() * 500);
}

export interface LiveHandlers {
  onChange(e: ChangeEvent): void;
  onResync(): void;
}

export function useLiveUpdates(handlers: LiveHandlers): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setStatus("offline");
      return;
    }
    const dedupe = new EventDeduper();
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let everConnected = false;
    let disposed = false;

    const open = () => {
      if (disposed) return;
      es?.close();
      es = new EventSource(eventsUrl(dedupe.cursor));
      es.onopen = () => {
        attempt = 0;
        setStatus("live");
      };
      es.addEventListener("ready", (m) => {
        // A fresh stream with no cursor. Data loaded before this point was fetched without a
        // version and may be an edge-cached copy, and after an earlier connection we can't know
        // what we missed, so reload once at the current version if anything ever changed.
        const id = Number((m as MessageEvent).lastEventId);
        dedupe.advance(id);
        const moved = setDataVersion(id);
        if (everConnected || moved) ref.current.onResync();
        everConnected = true;
      });
      es.addEventListener("resync", (m) => {
        everConnected = true;
        const id = Number((m as MessageEvent).lastEventId);
        dedupe.advance(id);
        setDataVersion(id);
        ref.current.onResync();
      });
      es.addEventListener("change", (m) => {
        everConnected = true;
        let e: ChangeEvent;
        try {
          e = JSON.parse((m as MessageEvent<string>).data) as ChangeEvent;
        } catch {
          return;
        }
        if (dedupe.accept(e.id)) {
          setDataVersion(e.id);
          ref.current.onChange(e);
        }
      });
      es.onerror = () => {
        if (!es || es.readyState === EventSource.CONNECTING) {
          setStatus(navigator.onLine === false ? "offline" : "reconnecting");
          return;
        }
        // CLOSED: the browser gave up; reconnect ourselves.
        es.close();
        setStatus(navigator.onLine === false ? "offline" : "reconnecting");
        clearTimeout(timer);
        timer = setTimeout(open, backoffMs(attempt++));
      };
    };

    const online = () => {
      if (es?.readyState === EventSource.CLOSED) {
        clearTimeout(timer);
        attempt = 0;
        open();
      }
    };
    const offline = () => setStatus("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    open();

    return () => {
      disposed = true;
      clearTimeout(timer);
      es?.close();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  return status;
}
