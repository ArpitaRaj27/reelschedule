import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useAnnounce } from "../components/Announcer";
import { ErrorNotice, Loading } from "../components/States";
import { Timeline, TimelineLegend, type TimelineItem } from "../components/Timeline";
import { ApiError, api, describeError, query } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useDebounced, useFilms, useMeta, useRoomSchedule, useRooms } from "../lib/queries";
import { clockTime, formatDay, zonedToIso } from "../lib/time";
import type { Conflict, Film, Preview, ScheduleInput, Screening, TmdbSearchResult } from "../lib/types";
import { RoomSelect } from "./Catalog";

export function ConsolePage() {
  const { status, canProgram, me } = useAuth();
  if (status === "checking") return <Loading label="Checking your sign-in" rows={2} />;
  if (status !== "signed-in") {
    return (
      <div className="page-narrow">
        <h1>Schedule a screening</h1>
        <p>
          Only festival programmers can change the schedule. <Link to="/sign-in?next=/console">Sign in</Link> to continue.
        </p>
      </div>
    );
  }
  if (!canProgram) {
    return (
      <div className="page-narrow">
        <h1>Schedule a screening</h1>
        <p>
          You're signed in as <strong>{me?.sub}</strong>, which can view the program but can't change it. Ask a festival admin to give
          your account the Programmer role.
        </p>
      </div>
    );
  }
  return <ScheduleForm />;
}

function ScheduleForm() {
  const meta = useMeta();
  const tz = meta.timezone;
  const rooms = useRooms();
  const films = useFilms();
  const qc = useQueryClient();

  const [filmId, setFilmId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("18:00");
  const [buffer, setBuffer] = useState("");
  const [created, setCreated] = useState<Screening | null>(null);
  const ids = { film: useId(), room: useId(), day: useId(), time: useId(), buffer: useId() };

  useEffect(() => {
    if (!day && meta.days[0]) setDay(meta.days[0]);
  }, [day, meta.days]);

  const input = useMemo<ScheduleInput | null>(() => {
    if (!filmId || !roomId || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
    const b = buffer.trim() === "" ? undefined : Number(buffer);
    return { filmId, roomId, startsAt: zonedToIso(day, time, tz), ...(b !== undefined && Number.isFinite(b) ? { bufferMinutes: b } : {}) };
  }, [filmId, roomId, day, time, buffer, tz]);
  const debounced = useDebounced(input, 250);

  const preview = useQuery({
    queryKey: ["preview", debounced],
    queryFn: ({ signal }) => api<Preview>("/api/screenings/preview", { method: "POST", body: debounced, auth: true, signal }),
    enabled: debounced !== null,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const roomDay = useRoomSchedule(roomId || undefined, day || undefined);

  const schedule = useMutation({
    mutationFn: (body: ScheduleInput) => api<Screening>("/api/screenings", { method: "POST", body, auth: true }),
    onSuccess: (s) => {
      setCreated(s); // confirmed inline; other viewers (and this tab) also get the live announcement
      void qc.invalidateQueries({ queryKey: ["screenings"] });
      void qc.invalidateQueries({ queryKey: ["room-schedule"] });
      void qc.invalidateQueries({ queryKey: ["preview"] });
      void qc.invalidateQueries({ queryKey: ["meta"] });
    },
  });

  // Any edit after a result clears it, so messages always describe the current form.
  useEffect(() => {
    schedule.reset();
    setCreated(null);
  }, [filmId, roomId, day, time, buffer]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (input) schedule.mutate(input);
  };

  const scheduleErr = schedule.error instanceof ApiError ? schedule.error : null;
  const previewErr = preview.error instanceof ApiError ? preview.error : null;
  const fields = { ...(previewErr?.fieldErrors() ?? {}), ...(scheduleErr?.fieldErrors() ?? {}) };
  const runtimeMissing = previewErr?.code === "runtime_missing" || scheduleErr?.code === "runtime_missing";
  const conflicts: Conflict[] =
    scheduleErr?.code === "schedule_conflict" ? ((scheduleErr.details as { conflicts?: Conflict[] })?.conflicts ?? []) : (preview.data?.conflicts ?? []);
  const previewCurrent = preview.data && debounced === input && !preview.isPlaceholderData;
  const selectedFilm = films.data?.find((f) => f.id === filmId);
  const room = rooms.data?.find((r) => r.id === roomId);

  const timelineItems: TimelineItem[] = [
    ...(roomDay.data?.screenings ?? []).map((x) => ({
      id: x.id,
      title: x.film.title,
      startsAt: x.startsAt,
      endsAt: x.endsAt,
      occupiedUntil: x.occupiedUntil,
      kind: x.status,
      href: `/screenings/${x.id}`,
    })),
    ...(preview.data && !runtimeMissing && !created && preview.data.roomId === roomId
      ? [
          {
            id: "proposed",
            title: preview.data.film.title,
            startsAt: preview.data.startsAt,
            endsAt: preview.data.endsAt,
            occupiedUntil: preview.data.occupiedUntil,
            kind: preview.data.ok ? ("proposed" as const) : ("conflict" as const),
          },
        ]
      : []),
  ];

  return (
    <div className="console">
      <header className="page-head">
        <h1>Schedule a screening</h1>
        <p className="lede">Pick a film, a room and a start time. The preview shows when the room is busy, including the turnaround, before you save.</p>
      </header>

      <div className="console-layout">
        <form className="panel schedule-form" onSubmit={submit} noValidate aria-describedby="schedule-status">
          <div className="field">
            <label htmlFor={ids.film}>Film</label>
            <select id={ids.film} value={filmId} onChange={(e) => setFilmId(e.target.value)} required aria-invalid={Boolean(fields.filmId) || runtimeMissing} aria-describedby={`${ids.film}-msg`}>
              <option value="">Choose a film</option>
              {(films.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                  {f.releaseYear ? ` (${f.releaseYear})` : ""}, {f.runtimeMinutes ? `${f.runtimeMinutes} min` : "no runtime"}
                </option>
              ))}
            </select>
            <small id={`${ids.film}-msg`} className={runtimeMissing || fields.filmId ? "field-error" : undefined}>
              {runtimeMissing
                ? "This film has no runtime on record, so its end time can't be worked out. Choose another film."
                : (fields.filmId ?? "Not listed? Find it on TMDB below and add it.")}
            </small>
          </div>

          <div className="field">
            <label htmlFor={ids.room}>Room</label>
            <RoomSelect id={ids.room} rooms={rooms.data ?? []} value={roomId} onChange={setRoomId} required />
            {fields.roomId && <small className="field-error">{fields.roomId}</small>}
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor={ids.day}>Day</label>
              <input id={ids.day} type="date" value={day} onChange={(e) => setDay(e.target.value)} required list={`${ids.day}-days`} />
              <datalist id={`${ids.day}-days`}>
                {meta.days.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor={ids.time}>Starts at</label>
              <input id={ids.time} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required aria-invalid={Boolean(fields.startsAt)} />
              {fields.startsAt && <small className="field-error">{fields.startsAt}</small>}
            </div>
          </div>

          <div className="field">
            <label htmlFor={ids.buffer}>Turnaround after the film (minutes)</label>
            <input
              id={ids.buffer}
              type="number"
              min={0}
              max={120}
              step={5}
              value={buffer}
              placeholder={String(meta.defaultBufferMinutes)}
              onChange={(e) => setBuffer(e.target.value)}
              aria-invalid={Boolean(fields.bufferMinutes)}
            />
            <small className={fields.bufferMinutes ? "field-error" : undefined}>
              {fields.bufferMinutes ?? `Time to clear and reset the room. Leave empty for the festival default of ${meta.defaultBufferMinutes} minutes.`}
            </small>
          </div>

          <div id="schedule-status" aria-live="polite">
            {created && (
              <p className="form-ok">
                Scheduled <Link to={`/screenings/${created.id}`}>{created.film.title}</Link> at {clockTime(created.startsAt, tz)} in {created.room.name}.
              </p>
            )}
            {schedule.isError && !runtimeMissing && (
              <div className="form-error" role="alert">
                <p>{scheduleErr?.code === "schedule_conflict" ? "Not scheduled: the room is busy for part of that time." : describeError(schedule.error)}</p>
              </div>
            )}
          </div>

          <button type="submit" className="button primary" disabled={!input || schedule.isPending || Boolean(created)}>
            {schedule.isPending ? "Scheduling…" : "Schedule screening"}
          </button>
        </form>

        <section className="panel preview" aria-labelledby="preview-title" aria-live="polite">
          <h2 id="preview-title">Preview</h2>
          {!input && <p className="hint">Choose a film, room, day and time to see the room's day and check for overlaps.</p>}
          {input && preview.isFetching && !preview.data && <Loading rows={1} label="Checking the room" />}
          {input && preview.isError && !runtimeMissing && previewErr?.code !== "validation_failed" && <ErrorNotice error={preview.error} />}
          {preview.data && !runtimeMissing && !created && (
            <div className={`verdict ${preview.data.ok ? "is-ok" : "is-conflict"}${previewCurrent ? "" : " is-updating"}`}>
              <p className="verdict-line">
                {selectedFilm?.title ?? preview.data.film.title} runs {clockTime(preview.data.startsAt, tz)}–{clockTime(preview.data.endsAt, tz)}. With a{" "}
                {preview.data.bufferMinutes}-minute turnaround, {room?.name ?? "the room"} is busy until <strong>{clockTime(preview.data.occupiedUntil, tz)}</strong>.
              </p>
              <p className="verdict-result">{preview.data.ok ? "No overlaps. Ready to schedule." : "Overlaps with:"}</p>
              {!preview.data.ok && <ConflictList conflicts={conflicts} tz={tz} />}
            </div>
          )}
          {scheduleErr?.code === "schedule_conflict" && preview.data?.ok && (
            <div className="verdict is-conflict">
              <p className="verdict-result">Someone booked this slot a moment ago. It now overlaps with:</p>
              <ConflictList conflicts={conflicts} tz={tz} />
            </div>
          )}
          {roomId && day && roomDay.data && (
            <>
              <h3 className="preview-day">
                {room?.name}, {formatDay(day)}
              </h3>
              <Timeline day={day} tz={tz} label={`${room?.name ?? "Room"} on ${formatDay(day)}, with the new screening`} rows={[{ id: roomId, label: room?.name ?? "Room", items: timelineItems }]} />
              <TimelineLegend />
            </>
          )}
        </section>
      </div>

      <TmdbSearch onAdded={(f) => setFilmId(f.id)} />
    </div>
  );
}

export function ConflictList({ conflicts, tz }: { conflicts: Conflict[]; tz: string }) {
  return (
    <ul className="conflicts">
      {conflicts.map((c) => (
        <li key={c.id}>
          <Link to={`/screenings/${c.id}`}>{c.title}</Link> from {clockTime(c.startsAt, tz)}, room busy until {clockTime(c.occupiedUntil, tz)}
        </li>
      ))}
    </ul>
  );
}

function TmdbSearch({ onAdded }: { onAdded: (f: Film) => void }) {
  const qc = useQueryClient();
  const announce = useAnnounce();
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState("");
  const id = useId();

  const results = useQuery({
    queryKey: ["tmdb-search", submitted],
    queryFn: ({ signal }) => api<TmdbSearchResult>(`/api/films/search${query({ q: submitted })}`, { auth: true, signal }),
    enabled: submitted.length >= 2,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const add = useMutation({
    mutationFn: (tmdbId: number) => api<{ film: Film; stale: boolean }>("/api/films/import", { method: "POST", body: { tmdbId }, auth: true }),
    onSuccess: async ({ film }) => {
      await qc.invalidateQueries({ queryKey: ["films"] });
      void qc.invalidateQueries({ queryKey: ["genres"] });
      onAdded(film);
      announce(
        film.runtimeMinutes
          ? `Added ${film.title} (${film.runtimeMinutes} min) and selected it.`
          : `Added ${film.title}. TMDB lists no runtime for it, so it can't be scheduled yet.`,
      );
    },
  });

  return (
    <section className="panel tmdb" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Find a film on TMDB</h2>
      <form
        className="tmdb-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(text.trim());
        }}
      >
        <label htmlFor={id} className="visually-hidden">
          Film title on TMDB
        </label>
        <input id={id} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Film title" minLength={2} maxLength={100} />
        <button type="submit" className="button secondary" disabled={text.trim().length < 2}>
          Search TMDB
        </button>
      </form>

      {results.isFetching && <Loading rows={2} label="Searching TMDB" />}
      {results.isError && <ErrorNotice error={results.error} onRetry={() => void results.refetch()} />}
      {results.data?.stale && <p className="hint">TMDB isn't responding, so these are saved results from {new Date(results.data.fetchedAt).toLocaleString()}.</p>}
      {results.data && results.data.items.length === 0 && <p>No films on TMDB match "{submitted}".</p>}
      {results.data && results.data.items.length > 0 && (
        <ul className="tmdb-results">
          {results.data.items.slice(0, 10).map((r) => (
            <li key={r.tmdbId}>
              <span>
                {r.title}
                {r.releaseYear ? ` (${r.releaseYear})` : ""}
              </span>
              <button type="button" className="button secondary small" disabled={add.isPending} onClick={() => add.mutate(r.tmdbId)}>
                Add to ReelSchedule
              </button>
            </li>
          ))}
        </ul>
      )}
      {add.isError && (
        <p className="field-error" role="alert">
          {describeError(add.error)}
        </p>
      )}
      <p className="attribution">Film data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </section>
  );
}
