import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { ErrorNotice, Loading } from "../components/States";
import { Timeline, TimelineLegend } from "../components/Timeline";
import { ApiError, api, describeError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useMeta, useRoomSchedule, useRooms, useScreening } from "../lib/queries";
import { clockTime, formatDay, formatDuration, isoDay, zonedToIso } from "../lib/time";
import type { Screening } from "../lib/types";
import { RoomSelect } from "./Catalog";
import { ConflictList } from "./Console";

export function ScreeningPage() {
  const { id } = useParams();
  const meta = useMeta();
  const tz = meta.timezone;
  const screening = useScreening(id);
  const s = screening.data;
  const day = s ? isoDay(s.startsAt, tz) : undefined;
  const roomDay = useRoomSchedule(s?.room.id, day);
  const { canProgram } = useAuth();

  if (screening.isPending) return <Loading label="Loading the screening" rows={3} />;
  if (screening.isError) {
    const missing = screening.error instanceof ApiError && screening.error.status === 404;
    return (
      <div className="page-narrow">
        <h1>{missing ? "Screening not found" : "Couldn't load this screening"}</h1>
        {missing ? (
          <p>
            This screening doesn't exist or its link is wrong. <Link to="/">Back to the program</Link>
          </p>
        ) : (
          <ErrorNotice error={screening.error} onRetry={() => void screening.refetch()} />
        )}
      </div>
    );
  }
  if (!s || !day) return null;

  const canceled = s.status === "canceled";
  return (
    <article className="screening">
      <p className="crumbs">
        <Link to={`/?date=${day}`}>{formatDay(day)}</Link>
      </p>
      <header className="screening-head">
        <h1>{s.film.title}</h1>
        {canceled && <span className="badge canceled large">Canceled</span>}
      </header>

      <dl className="facts">
        <div>
          <dt>Showing</dt>
          <dd className="fact-big">
            <time dateTime={s.startsAt}>{clockTime(s.startsAt, tz)}</time>–<time dateTime={s.endsAt}>{clockTime(s.endsAt, tz)}</time>
          </dd>
        </div>
        <div>
          <dt>Room</dt>
          <dd>
            <Link to={`/rooms/${s.room.id}?date=${day}`}>{s.room.name}</Link>, {s.room.venue.name}
            <br />
            {s.room.seats} seats
          </dd>
        </div>
        <div>
          <dt>Running time</dt>
          <dd>{formatDuration(s.runtimeMinutes)}</dd>
        </div>
        <div>
          <dt>Room free again</dt>
          <dd>{canceled ? "Now (screening canceled)" : `${clockTime(s.occupiedUntil, tz)}, after a ${s.bufferMinutes}-minute turnaround`}</dd>
        </div>
        {s.film.genres.length > 0 && (
          <div>
            <dt>Genre</dt>
            <dd>{s.film.genres.join(", ")}</dd>
          </div>
        )}
        {s.film.releaseYear && (
          <div>
            <dt>Released</dt>
            <dd>{s.film.releaseYear}</dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="room-day">
        <h2 id="room-day">
          {s.room.name} on {formatDay(day, "short")}
        </h2>
        {roomDay.data ? (
          <Timeline
            day={day}
            tz={tz}
            label={`${s.room.name} schedule for ${formatDay(day)}`}
            rows={[
              {
                id: s.room.id,
                label: s.room.name,
                items: roomDay.data.screenings.map((x) => ({
                  id: x.id,
                  title: x.film.title,
                  startsAt: x.startsAt,
                  endsAt: x.endsAt,
                  occupiedUntil: x.occupiedUntil,
                  kind: x.status,
                  href: `/screenings/${x.id}`,
                  current: x.id === s.id,
                })),
              },
            ]}
          />
        ) : (
          <Loading rows={1} label="Loading the room's day" />
        )}
        <TimelineLegend />
      </section>

      {canProgram && !canceled && (
        <section className="manage" aria-labelledby="manage">
          <h2 id="manage">Change this screening</h2>
          <RescheduleForm s={s} tz={tz} onReload={() => void screening.refetch()} />
          <CancelForm s={s} onReload={() => void screening.refetch()} />
        </section>
      )}
    </article>
  );
}

function useScreeningInvalidation() {
  const qc = useQueryClient();
  return (s: Screening) => {
    qc.setQueryData(["screening", s.id], s);
    void qc.invalidateQueries({ queryKey: ["screenings"] });
    void qc.invalidateQueries({ queryKey: ["room-schedule"] });
    void qc.invalidateQueries({ queryKey: ["meta"] });
  };
}

function RescheduleForm({ s, tz, onReload }: { s: Screening; tz: string; onReload: () => void }) {
  const rooms = useRooms();
  const applied = useScreeningInvalidation();
  const [day, setDay] = useState(isoDay(s.startsAt, tz));
  const [time, setTime] = useState(clockTime(s.startsAt, tz));
  const [roomId, setRoomId] = useState(s.room.id);
  const [buffer, setBuffer] = useState(String(s.bufferMinutes));
  const ids = { day: useId(), time: useId(), room: useId(), buffer: useId() };

  // When someone else's change arrives (live update or reload), start from the new values.
  useEffect(() => {
    setDay(isoDay(s.startsAt, tz));
    setTime(clockTime(s.startsAt, tz));
    setRoomId(s.room.id);
    setBuffer(String(s.bufferMinutes));
  }, [s.version, s.startsAt, s.room.id, s.bufferMinutes, tz]);

  const move = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Screening>(`/api/screenings/${s.id}`, { method: "PATCH", body, auth: true }),
    onSuccess: applied, // the live update announces the move
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { version: s.version };
    const startsAt = zonedToIso(day, time, tz);
    if (new Date(startsAt).getTime() !== new Date(s.startsAt).getTime()) body.startsAt = startsAt;
    if (roomId !== s.room.id) body.roomId = roomId;
    if (Number(buffer) !== s.bufferMinutes) body.bufferMinutes = Number(buffer);
    move.mutate(body);
  };

  const err = move.error instanceof ApiError ? move.error : null;
  const fields = err?.fieldErrors() ?? {};
  const conflicts = err?.code === "schedule_conflict" ? ((err.details as { conflicts?: [] })?.conflicts ?? []) : [];

  return (
    <form className="panel" onSubmit={submit} noValidate>
      <h3>Move</h3>
      <div className="row">
        <div className="field">
          <label htmlFor={ids.day}>Day</label>
          <input id={ids.day} type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor={ids.time}>Starts at</label>
          <input id={ids.time} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required aria-invalid={Boolean(fields.startsAt)} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor={ids.room}>Room</label>
          <RoomSelect id={ids.room} rooms={rooms.data ?? []} value={roomId} onChange={setRoomId} required />
        </div>
        <div className="field">
          <label htmlFor={ids.buffer}>Turnaround (minutes)</label>
          <input id={ids.buffer} type="number" min={0} max={120} step={5} value={buffer} onChange={(e) => setBuffer(e.target.value)} aria-invalid={Boolean(fields.bufferMinutes)} />
        </div>
      </div>
      <p className="hint">The running time stays at {s.runtimeMinutes} minutes, as saved when this screening was scheduled.</p>
      {move.isError && (
        <div className="form-error" role="alert">
          <p>{err?.code === "validation_failed" ? Object.values(fields).join(" ") || describeError(err) : describeError(move.error)}</p>
          {conflicts.length > 0 && <ConflictList conflicts={conflicts} tz={tz} />}
          {err?.code === "stale_version" && (
            <button type="button" className="button secondary" onClick={() => { move.reset(); onReload(); }}>
              Load the latest version
            </button>
          )}
        </div>
      )}
      {move.isSuccess && (
        <p className="form-ok" role="status">
          Moved to {clockTime(move.data.startsAt, tz)} in {move.data.room.name}.
        </p>
      )}
      <button type="submit" className="button primary" disabled={move.isPending}>
        {move.isPending ? "Moving…" : "Move screening"}
      </button>
    </form>
  );
}

function CancelForm({ s, onReload }: { s: Screening; onReload: () => void }) {
  const applied = useScreeningInvalidation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const id = useId();
  const cancel = useMutation({
    mutationFn: () => api<Screening>(`/api/screenings/${s.id}/cancel`, { method: "POST", body: { version: s.version, reason: reason.trim() }, auth: true }),
    onSuccess: applied,
  });
  const tooShort = reason.trim().length < 3;

  if (!open) {
    return (
      <div className="panel">
        <h3>Cancel</h3>
        <p>Canceling frees the room for this slot. The screening stays on the program, marked canceled.</p>
        <button type="button" className="button danger-outline" onClick={() => setOpen(true)}>
          Cancel this screening…
        </button>
      </div>
    );
  }
  const err = cancel.error instanceof ApiError ? cancel.error : null;
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (!tooShort) cancel.mutate();
      }}
    >
      <h3>Cancel</h3>
      <div className="field">
        <label htmlFor={id}>Reason (shown in the audit log)</label>
        <textarea id={id} value={reason} maxLength={200} rows={2} onChange={(e) => setReason(e.target.value)} required aria-describedby={`${id}-hint`} />
        <small id={`${id}-hint`}>At least 3 characters, for example "Print damaged in transit".</small>
      </div>
      {cancel.isError && (
        <div className="form-error" role="alert">
          <p>{describeError(cancel.error)}</p>
          {err?.code === "stale_version" && (
            <button type="button" className="button secondary" onClick={() => { cancel.reset(); onReload(); }}>
              Load the latest version
            </button>
          )}
        </div>
      )}
      <div className="actions">
        <button type="submit" className="button danger" disabled={tooShort || cancel.isPending}>
          {cancel.isPending ? "Canceling…" : "Cancel screening"}
        </button>
        <button type="button" className="button link" onClick={() => setOpen(false)}>
          Keep it scheduled
        </button>
      </div>
    </form>
  );
}
