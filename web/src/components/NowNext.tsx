import { Link } from "react-router";
import { useFestivalStatus } from "../lib/queries";
import type { StatusItem } from "../lib/types";
import { clockTime, formatDay, isoDay } from "../lib/time";

/** Rows per column. The strip's height is fixed by this number, never by the data (no layout shift). */
const ROWS = 3;

/**
 * Program-page strip fed by GET /api/status: what is on right now and what starts next.
 *
 * Layout stability (HW5 Task 5): the strip used to render nothing until /api/status answered and then
 * push the whole program down (CLS 0.11 on its own in the field). It now renders its final box at once:
 * both columns are always present, each holds at most ROWS single-line rows, and the CSS reserves
 * ROWS lines per column, so loading, empty, error and full states all have the same height.
 */
export function NowNext({ tz }: { tz: string }) {
  const status = useFestivalStatus();
  const data = status.data;
  const today = data ? isoDay(data.generatedAt, tz) : undefined;

  return (
    <section className="now-next" aria-labelledby="now-next-title" aria-busy={status.isPending}>
      <h2 id="now-next-title" className="visually-hidden">
        Now showing and next up
      </h2>
      <div className="now-next-col">
        <h3>Now showing</h3>
        <ul>
          {status.isError && <li className="muted">Live status is unavailable right now.</li>}
          {data && data.nowShowing.length === 0 && <li className="muted">Nothing is showing right now.</li>}
          {data &&
            capped(data.nowShowing).shown.map((s) => (
              <li key={s.id}>
                <Link to={`/screenings/${s.id}`}>{s.title}</Link> in {s.room}, until {clockTime(s.endsAt, tz)}
              </li>
            ))}
          {data && capped(data.nowShowing).more > 0 && (
            <li>
              <Link to={`/grid?date=${today}`}>And {capped(data.nowShowing).more} more: see all rooms today</Link>
            </li>
          )}
        </ul>
      </div>
      <div className="now-next-col">
        <h3>Next up</h3>
        <ul>
          {status.isError && <li className="muted">Try reloading in a minute.</li>}
          {data && data.nextUp.length === 0 && <li className="muted">Nothing else is scheduled.</li>}
          {data &&
            data.nextUp.slice(0, ROWS).map((s) => (
              <li key={s.id}>
                <time dateTime={s.startsAt}>{startLabel(s.startsAt, tz, today)}</time>{" "}
                <Link to={`/screenings/${s.id}`}>{s.title}</Link> in {s.room}
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}

/** Short enough to keep the room name visible on a phone: "18:00" today, "Fri 18:00" on another day. */
function startLabel(startsAt: string, tz: string, today: string | undefined): string {
  const day = isoDay(startsAt, tz);
  return day === today ? clockTime(startsAt, tz) : `${formatDay(day, "weekday")} ${clockTime(startsAt, tz)}`;
}

/** At most ROWS rows: when more rooms are busy than fit, the last row becomes "and N more". */
function capped(items: StatusItem[]): { shown: StatusItem[]; more: number } {
  if (items.length <= ROWS) return { shown: items, more: 0 };
  return { shown: items.slice(0, ROWS - 1), more: items.length - (ROWS - 1) };
}
