import { Link } from "react-router";
import { useFestivalStatus } from "../lib/queries";
import { clockTime, formatDay, isoDay } from "../lib/time";

/** Program-page strip fed by GET /api/status: what is on right now and what starts next. */
export function NowNext({ tz }: { tz: string }) {
  const status = useFestivalStatus();
  if (!status.data) return null; // the program below has its own loading and error states
  const { nowShowing, nextUp } = status.data;
  if (nowShowing.length === 0 && nextUp.length === 0) return null;

  return (
    <section className="now-next" aria-labelledby="now-next-title">
      <h2 id="now-next-title" className="visually-hidden">
        Now showing and next up
      </h2>
      {nowShowing.length > 0 && (
        <div>
          <h3>Now showing</h3>
          <ul>
            {nowShowing.map((s) => (
              <li key={s.id}>
                <Link to={`/screenings/${s.id}`}>{s.title}</Link> in {s.room}, until {clockTime(s.endsAt, tz)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {nextUp.length > 0 && (
        <div>
          <h3>Next up</h3>
          <ul>
            {nextUp.slice(0, 3).map((s) => (
              <li key={s.id}>
                <time dateTime={s.startsAt}>
                  {formatDay(isoDay(s.startsAt, tz), "short")}, {clockTime(s.startsAt, tz)}
                </time>{" "}
                <Link to={`/screenings/${s.id}`}>{s.title}</Link> in {s.room}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
