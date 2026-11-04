import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Empty, ErrorNotice, Loading } from "../components/States";
import { Timeline, TimelineLegend } from "../components/Timeline";
import { ApiError } from "../lib/api";
import { useMeta, useRoomSchedule, useRooms, useScreenings } from "../lib/queries";
import { clockTime, formatDay } from "../lib/time";

function DayPicker({ days, value, onPick, label }: { days: string[]; value: string; onPick: (d: string) => void; label: string }) {
  return (
    <fieldset className="field days">
      <legend>{label}</legend>
      <div className="segmented">
        {days.map((d) => (
          <label key={d} className={`segment${value === d ? " is-on" : ""}`}>
            <input type="radio" name="grid-day" value={d} checked={value === d} onChange={() => onPick(d)} />
            {formatDay(d, "short")}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function useDayParam(days: string[]) {
  const [params, setParams] = useSearchParams();
  const date = params.get("date") ?? "";
  useEffect(() => {
    if (!date && days[0]) setParams({ date: days[0] }, { replace: true });
  }, [date, days, setParams]);
  return [date, (d: string) => setParams({ date: d })] as const;
}

/** All rooms side by side for one festival day. */
export function DayGridPage() {
  const meta = useMeta();
  const rooms = useRooms();
  const [date, setDate] = useDayParam(meta.days);
  const list = useScreenings({ date: date || undefined, pageSize: 100 });
  const ready = Boolean(date) && rooms.data && list.data;

  return (
    <div className="grid-page">
      <header className="page-head">
        <h1>Rooms by day</h1>
        <p className="lede">Each bar is a screening: the solid part is the film, the striped part is the turnaround before the room is free.</p>
      </header>
      {meta.days.length > 0 && <DayPicker days={meta.days} value={date} onPick={setDate} label="Day" />}
      {(rooms.isPending || list.isPending) && <Loading rows={4} />}
      {rooms.isError && <ErrorNotice error={rooms.error} onRetry={() => void rooms.refetch()} />}
      {list.isError && <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />}
      {ready && (
        <>
          <Timeline
            day={date}
            tz={meta.timezone}
            label={`All rooms on ${formatDay(date)}`}
            rows={rooms.data.map((r) => ({
              id: r.id,
              label: r.name,
              sublabel: r.venue.name,
              href: `/rooms/${r.id}?date=${date}`,
              items: list.data.items
                .filter((s) => s.room.id === r.id)
                .map((s) => ({ id: s.id, title: s.film.title, startsAt: s.startsAt, endsAt: s.endsAt, occupiedUntil: s.occupiedUntil, kind: s.status, href: `/screenings/${s.id}` })),
            }))}
          />
          <TimelineLegend />
        </>
      )}
    </div>
  );
}

/** One room's day as a timeline plus a plain list. */
export function RoomPage() {
  const { id } = useParams();
  const meta = useMeta();
  const [date, setDate] = useDayParam(meta.days);
  const schedule = useRoomSchedule(id, date || undefined);
  const tz = meta.timezone;

  if (schedule.isError) {
    const missing = schedule.error instanceof ApiError && schedule.error.status === 404;
    return (
      <div className="page-narrow">
        <h1>{missing ? "Room not found" : "Couldn't load this room"}</h1>
        {missing ? <Link to="/grid">See all rooms</Link> : <ErrorNotice error={schedule.error} onRetry={() => void schedule.refetch()} />}
      </div>
    );
  }
  if (!schedule.data) return <Loading rows={3} label="Loading the room" />;
  const { room, screenings } = schedule.data;

  return (
    <div className="room-page">
      <p className="crumbs">
        <Link to={`/grid${date ? `?date=${date}` : ""}`}>Rooms by day</Link>
      </p>
      <header className="page-head">
        <h1>{room.name}</h1>
        <p className="lede">
          {room.venue}, {room.seats} seats
        </p>
      </header>
      {meta.days.length > 0 && <DayPicker days={meta.days} value={date} onPick={setDate} label="Day" />}
      {date && (
        <>
          <Timeline
            day={date}
            tz={tz}
            label={`${room.name} on ${formatDay(date)}`}
            rows={[
              {
                id: room.id,
                label: room.name,
                items: screenings.map((s) => ({ id: s.id, title: s.film.title, startsAt: s.startsAt, endsAt: s.endsAt, occupiedUntil: s.occupiedUntil, kind: s.status, href: `/screenings/${s.id}` })),
              },
            ]}
          />
          <TimelineLegend />
        </>
      )}
      {screenings.length === 0 ? (
        <Empty title={`Nothing is scheduled in ${room.name} on this day.`} />
      ) : (
        <ol className="listing">
          {screenings.map((s) => (
            <li key={s.id} className={`listing-row${s.status === "canceled" ? " is-canceled" : ""}`}>
              <time className="listing-time" dateTime={s.startsAt}>
                {clockTime(s.startsAt, tz)}
              </time>
              <div className="listing-body">
                <Link to={`/screenings/${s.id}`} className="listing-title">
                  {s.film.title}
                </Link>
                {s.status === "canceled" && <span className="badge canceled">Canceled</span>}
                <p className="listing-meta">
                  <span>Ends {clockTime(s.endsAt, tz)}</span>
                  {s.status === "scheduled" && <span>Room free at {clockTime(s.occupiedUntil, tz)}</span>}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
