import { Fragment, useLayoutEffect, useRef, type CSSProperties } from "react";
import { Link } from "react-router";
import { clockTime, minutesFromDayStart } from "../lib/time";

/**
 * One festival day as rows of rooms. Each screening is drawn as its runtime (solid) followed
 * by its turnaround buffer (hatched), so "occupied until" is visible, not just the end time.
 * The same picture is used on the program, the screening page and the scheduling preview.
 */

export type TimelineKind = "scheduled" | "canceled" | "proposed" | "conflict";

export interface TimelineItem {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  occupiedUntil: string;
  kind: TimelineKind;
  href?: string;
  current?: boolean;
}

export interface TimelineRow {
  id: string;
  label: string;
  sublabel?: string;
  href?: string;
  items: TimelineItem[];
}

interface Props {
  day: string;
  tz: string;
  rows: TimelineRow[];
  label: string;
  /** Hours always shown, widened to fit early or late screenings. */
  minHour?: number;
  maxHour?: number;
}

export function Timeline({ day, tz, rows, label, minHour = 10, maxHour = 24 }: Props) {
  const mins = (iso: string) => minutesFromDayStart(iso, day, tz);
  const all = rows.flatMap((r) => r.items);
  const earliest = Math.min(minHour * 60, ...all.map((i) => mins(i.startsAt)));
  const latest = Math.max(maxHour * 60, ...all.map((i) => mins(i.occupiedUntil)));
  const startH = Math.max(0, Math.floor(earliest / 60));
  const endH = Math.min(36, Math.ceil(latest / 60));
  const span = (endH - startH) * 60;
  const pct = (m: number) => ((m - startH * 60) / span) * 100;
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);

  // When the day is wider than the screen, open scrolled to the screening that matters
  // (the current or proposed one, else the earliest) with a little context to its left.
  const scroller = useRef<HTMLDivElement>(null);
  const focusKey = `${day}|${all.find((i) => i.current || i.kind === "proposed" || i.kind === "conflict")?.startsAt ?? ""}|${all.length}`;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const target =
      el.querySelector<HTMLElement>(".is-current, .is-proposed, .is-conflict") ??
      [...el.querySelectorAll<HTMLElement>(".tl-block")].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
    const track = el.querySelector<HTMLElement>(".tl-track");
    const labelWidth = el.querySelector<HTMLElement>(".tl-label")?.offsetWidth ?? 0;
    if (!target || !track) return;
    const hourWidth = track.scrollWidth / (endH - startH);
    const box = el.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const offset = t.left - box.left;
    if (offset >= labelWidth && t.right - box.left <= el.clientWidth) return; // already in view
    el.scrollLeft = Math.max(0, el.scrollLeft + offset - labelWidth - hourWidth * 1.5);
  }, [focusKey, endH, startH]);

  return (
    <figure className="timeline" aria-label={label}>
      <div className="timeline-scroll" ref={scroller}>
        <div className="timeline-grid" style={{ "--hours": endH - startH } as CSSProperties}>
          <div className="tl-corner" aria-hidden="true" />
          <div className="tl-ruler" aria-hidden="true">
            {hours.map((h) => (
              <span key={h} style={{ left: `${pct(h * 60)}%` }}>
                {String(h % 24).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <div className="tl-label">
                {row.href ? <Link to={row.href}>{row.label}</Link> : <span>{row.label}</span>}
                {row.sublabel && <small>{row.sublabel}</small>}
              </div>
              <ul className="tl-track" aria-label={`${row.label} schedule`}>
                {row.items.length === 0 && <li className="tl-free">Free all day</li>}
                {row.items.map((item) => (
                  <Block key={item.id} item={item} pct={pct} mins={mins} tz={tz} />
                ))}
              </ul>
            </Fragment>
          ))}
        </div>
      </div>
    </figure>
  );
}

function Block({ item, pct, mins, tz }: { item: TimelineItem; pct: (m: number) => number; mins: (iso: string) => number; tz: string }) {
  const start = pct(mins(item.startsAt));
  const end = pct(mins(item.endsAt));
  // A canceled screening no longer holds the room, so its buffer isn't drawn.
  const occupied = item.kind === "canceled" ? end : pct(mins(item.occupiedUntil));
  const total = Math.max(occupied - start, 0.5);
  const filmShare = ((end - start) / total) * 100;
  const from = clockTime(item.startsAt, tz);
  const to = clockTime(item.endsAt, tz);
  const free = clockTime(item.occupiedUntil, tz);
  // The name starts with exactly what the block shows ("18:00 The Quiet Harbor"), then adds what only the
  // shape shows. A voice-control user says the visible words, so they must be in the name, in that order
  // (WCAG 2.5.3 Label in Name; axe label-content-name-mismatch, HW5 Task 7).
  const kindNote = item.kind === "proposed" ? " (new)" : item.kind === "conflict" ? " (new, overlaps)" : "";
  const description =
    item.kind === "canceled"
      ? `${from} ${item.title}, until ${to}, canceled`
      : `${from} ${item.title}${kindNote}, until ${to}, room free at ${free}`;

  const inner = (
    <>
      <span className="tl-film" style={{ flexBasis: `${filmShare}%` }}>
        {/* The space keeps the text "18:00 The Quiet Harbor" rather than "18:00The…" for anything that reads
            the DOM (axe, voice control). .tl-film is a flex column, so a whitespace-only text node is not drawn. */}
        <span className="tl-time">{from}</span>{" "}
        <span className="tl-title">{item.title}</span>
      </span>
      {item.kind !== "canceled" && <span className="tl-buffer" aria-hidden="true" />}
    </>
  );
  const style = { left: `${start}%`, width: `${total}%` };
  const className = `tl-block is-${item.kind}${item.current ? " is-current" : ""}`;

  return (
    <li className="tl-item" style={style}>
      {item.href ? (
        <Link to={item.href} className={className} aria-label={description} aria-current={item.current ? "page" : undefined}>
          {inner}
        </Link>
      ) : (
        <span className={className} role="img" aria-label={description}>
          {inner}
        </span>
      )}
    </li>
  );
}

export function TimelineLegend() {
  return (
    <ul className="tl-legend" aria-label="How to read the timeline">
      <li>
        <span className="swatch film" aria-hidden="true" /> Film runtime
      </li>
      <li>
        <span className="swatch buffer" aria-hidden="true" /> Turnaround (room still busy)
      </li>
      <li>
        <span className="swatch canceled" aria-hidden="true" /> Canceled
      </li>
    </ul>
  );
}
