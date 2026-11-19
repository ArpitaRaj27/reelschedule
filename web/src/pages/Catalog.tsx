import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { NowNext } from "../components/NowNext";
import { Empty, ErrorNotice, Loading } from "../components/States";
import { FALLBACK_META, useDebounced, useGenres, useMetaQuery, useRooms, useScreenings, type ScreeningFilters } from "../lib/queries";
import { clockTime, formatDay, isoDay } from "../lib/time";
import type { Room, Screening, ScreeningStatus } from "../lib/types";

const PAGE_SIZE = 25;
const FILTER_KEYS = ["q", "date", "roomId", "genre", "status"] as const;

export function CatalogPage() {
  const metaQuery = useMetaQuery();
  const meta = metaQuery.data ?? FALLBACK_META;
  // The day filter is built from /api/meta. Laying the filters out before it answers meant the Day field
  // grew a row when it did and pushed everything below it (a layout shift), so wait for it: on success,
  // or on failure with the fallback (then the Day filter offers only "All days").
  const metaSettled = !metaQuery.isPending;
  const rooms = useRooms();
  const genres = useGenres();
  const [params, setParams] = useSearchParams();

  const filters: ScreeningFilters = {
    q: params.get("q") ?? undefined,
    date: params.get("date") ?? undefined,
    roomId: params.get("roomId") ?? undefined,
    genre: params.get("genre") ?? undefined,
    status: (params.get("status") as ScreeningStatus | null) ?? undefined,
    page: Number(params.get("page") ?? 1) || 1,
    pageSize: PAGE_SIZE,
  };
  const list = useScreenings(filters);

  const update = (key: string, value: string | undefined) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "page") next.delete("page");
        return next;
      },
      { replace: key === "q" },
    );
  };
  const active = FILTER_KEYS.some((k) => params.get(k));

  // The search box updates the URL once typing pauses; the URL wins after back/forward.
  const [text, setText] = useState(filters.q ?? "");
  const debounced = useDebounced(text, 300).trim();
  const qParam = params.get("q") ?? "";
  useEffect(() => {
    if (debounced !== qParam) update("q", debounced || undefined);
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (qParam !== debounced) setText(qParam);
  }, [qParam]); // eslint-disable-line react-hooks/exhaustive-deps
  // Both "Clear filters" buttons disappear once nothing is filtered. Without this, the button a keyboard user
  // just pressed is removed under them, focus falls to <body>, and their next Tab lands in the results list,
  // past every filter (HW5 Task 7, a defect axe cannot see). Focus goes to the first filter instead; the
  // polite "N screenings" line still announces the new result count.
  const searchRef = useRef<HTMLInputElement>(null);
  const clear = () => {
    setText("");
    setParams({});
    searchRef.current?.focus();
  };

  const byDay = useMemo(() => groupByDay(list.data?.items ?? [], meta.timezone), [list.data, meta.timezone]);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.count / PAGE_SIZE)) : 1;
  const ids = { search: useId(), room: useId(), genre: useId(), status: useId() };

  return (
    <div className="catalog">
      <header className="page-head">
        <h1>Program</h1>
        <p className="lede">Every screening at {meta.festivalName}, with the room, running time and when the room is free again.</p>
      </header>

      <NowNext tz={meta.timezone} />

      {!metaSettled && <Loading label="Loading the program" />}
      {metaSettled && (
        <div className="catalog-layout">
          <form className="filters" role="search" aria-label="Filter screenings" onSubmit={(e) => e.preventDefault()}>
            <div className="field">
              <label htmlFor={ids.search}>Film title</label>
              <input ref={searchRef} id={ids.search} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search titles" autoComplete="off" />
            </div>

            <fieldset className="field days">
              <legend>Day</legend>
              <div className="segmented">
                <DayOption label="All days" value="" current={filters.date ?? ""} onPick={(v) => update("date", v || undefined)} />
                {meta.days.map((d) => (
                  <DayOption key={d} label={formatDay(d, "short")} value={d} current={filters.date ?? ""} onPick={(v) => update("date", v)} />
                ))}
              </div>
            </fieldset>

            <div className="field">
              <label htmlFor={ids.room}>Room</label>
              <RoomSelect id={ids.room} rooms={rooms.data ?? []} value={filters.roomId ?? ""} onChange={(v) => update("roomId", v || undefined)} allLabel="All rooms" />
            </div>

            <div className="field">
              <label htmlFor={ids.genre}>Genre</label>
              <select id={ids.genre} value={filters.genre ?? ""} onChange={(e) => update("genre", e.target.value || undefined)}>
                <option value="">All genres</option>
                {(genres.data ?? []).map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor={ids.status}>Status</label>
              <select id={ids.status} value={filters.status ?? ""} onChange={(e) => update("status", e.target.value || undefined)}>
                <option value="">Scheduled and canceled</option>
                <option value="scheduled">Scheduled only</option>
                <option value="canceled">Canceled only</option>
              </select>
            </div>

            {active && (
              <button type="button" className="button link" onClick={clear}>
                Clear filters
              </button>
            )}
          </form>

          <section className="results" aria-labelledby="results-count" aria-busy={list.isFetching}>
            <p id="results-count" className="count" aria-live="polite">
              {list.data ? `${list.data.count} ${list.data.count === 1 ? "screening" : "screenings"}` : " "}
            </p>

            {list.isPending && <Loading />}
            {list.isError && <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />}
            {list.data && list.data.count === 0 && (
              <Empty title="No screenings match these filters.">
                <p>Try another day or room, or clear the filters to see the whole program.</p>
                {active && (
                  <button type="button" className="button secondary" onClick={clear}>
                    Clear filters
                  </button>
                )}
              </Empty>
            )}

            {byDay.map(([day, items]) => (
              <section key={day} className="day-group" aria-labelledby={`day-${day}`}>
                <h2 id={`day-${day}`}>
                  {formatDay(day)}
                  <Link className="day-grid-link" to={`/grid?date=${day}`}>
                    See rooms side by side
                  </Link>
                </h2>
                <ol className="listing">
                  {items.map((s) => (
                    <ScreeningRow key={s.id} s={s} tz={meta.timezone} />
                  ))}
                </ol>
              </section>
            ))}

            {list.data && pages > 1 && (
              <nav className="pager" aria-label="Pages">
                <button type="button" className="button secondary" disabled={(filters.page ?? 1) <= 1} onClick={() => update("page", String((filters.page ?? 1) - 1))}>
                  Previous page
                </button>
                <span>
                  Page {filters.page} of {pages}
                </span>
                <button type="button" className="button secondary" disabled={(filters.page ?? 1) >= pages} onClick={() => update("page", String((filters.page ?? 1) + 1))}>
                  Next page
                </button>
              </nav>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function DayOption({ label, value, current, onPick }: { label: string; value: string; current: string; onPick: (v: string) => void }) {
  return (
    <label className={`segment${current === value ? " is-on" : ""}`}>
      <input type="radio" name="day" value={value} checked={current === value} onChange={() => onPick(value)} />
      {label}
    </label>
  );
}

export function RoomSelect({ id, rooms, value, onChange, allLabel, required }: { id: string; rooms: Room[]; value: string; onChange: (v: string) => void; allLabel?: string; required?: boolean }) {
  const venues = new Map<string, Room[]>();
  for (const r of rooms) venues.set(r.venue.name, [...(venues.get(r.venue.name) ?? []), r]);
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">{allLabel ?? "Choose a room"}</option>
      {[...venues].map(([venue, list]) => (
        <optgroup key={venue} label={venue}>
          {list.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.seats} seats)
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ScreeningRow({ s, tz }: { s: Screening; tz: string }) {
  const canceled = s.status === "canceled";
  return (
    <li className={`listing-row${canceled ? " is-canceled" : ""}`}>
      <time className="listing-time" dateTime={s.startsAt}>
        {clockTime(s.startsAt, tz)}
      </time>
      <div className="listing-body">
        <Link to={`/screenings/${s.id}`} className="listing-title">
          {s.film.title}
        </Link>
        {canceled && <span className="badge canceled">Canceled</span>}
        <p className="listing-meta">
          <span>
            {s.room.name}, {s.room.venue.name}
          </span>
          <span>{s.runtimeMinutes} min</span>
          {!canceled && <span>Room free at {clockTime(s.occupiedUntil, tz)}</span>}
          {s.film.genres.length > 0 && <span>{s.film.genres.join(", ")}</span>}
        </p>
      </div>
    </li>
  );
}

function groupByDay(items: Screening[], tz: string): [string, Screening[]][] {
  const map = new Map<string, Screening[]>();
  for (const s of items) {
    const d = isoDay(s.startsAt, tz);
    map.set(d, [...(map.get(d) ?? []), s]);
  }
  return [...map];
}
