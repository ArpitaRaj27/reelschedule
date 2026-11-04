import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { dataVersion, resetDataVersion } from "../src/lib/freshness";
import { EventDeduper, backoffMs, eventsUrl, useLiveUpdates, type LiveHandlers } from "../src/lib/live";

/** Minimal stand-in for the browser's EventSource that tests can drive. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  emit(type: string, id: number, data: unknown) {
    const e = new MessageEvent(type, { data: JSON.stringify(data), lastEventId: String(id) });
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  fail(closed: boolean) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.onerror?.();
  }
}

function Probe(props: LiveHandlers) {
  const status = useLiveUpdates(props);
  return <p>status: {status}</p>;
}

const change = (id: number) => ({ id, type: "screening.created", screeningId: `s${id}`, roomId: "r", occurredAt: "", payload: {} });

describe("EventDeduper", () => {
  it("applies each id once, even out of order, and tracks the highest id as the cursor", () => {
    const d = new EventDeduper();
    expect([5, 3, 5, 4, 3].map((id) => d.accept(id))).toEqual([true, true, false, true, false]);
    expect(d.cursor).toBe(5);
  });

  it("forgets the oldest ids beyond its limit", () => {
    const d = new EventDeduper(2);
    d.accept(1);
    d.accept(2);
    d.accept(3);
    expect(d.accept(1)).toBe(true);
    expect(d.accept(3)).toBe(false);
  });
});

describe("live connection", () => {
  it("builds reconnect URLs with the cursor and backs off up to 30 s", () => {
    expect(eventsUrl(null)).toBe("/api/events");
    expect(eventsUrl(42)).toBe("/api/events?lastEventId=42");
    expect(backoffMs(0, () => 0)).toBe(1000);
    expect(backoffMs(3, () => 0)).toBe(8000);
    expect(backoffMs(10, () => 0)).toBe(30_000);
  });

  it("applies duplicate events once, reconnects with the cursor after the stream closes, and reloads on resync", async () => {
    vi.useFakeTimers();
    resetDataVersion();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    const onChange = vi.fn();
    const onResync = vi.fn();
    render(<Probe onChange={onChange} onResync={onResync} />);

    const first = FakeEventSource.instances[0]!;
    expect(first.url).toBe("/api/events");
    act(() => {
      first.open();
      first.emit("ready", 10, { latestEventId: 10 });
      first.emit("change", 11, change(11));
      first.emit("change", 11, change(11)); // duplicate delivery
      first.emit("change", 12, change(12));
    });
    expect(screen.getByText("status: live")).toBeInTheDocument();
    expect(onChange.mock.calls.map((c) => c[0].id)).toEqual([11, 12]);
    // Data loaded before the stream opened may predate event 10: reload once, at version 10.
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(dataVersion()).toBe(12);

    act(() => first.fail(true)); // server closed the stream for good
    expect(screen.getByText("status: reconnecting")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toBe("/api/events?lastEventId=12");

    act(() => {
      second.open();
      second.emit("change", 12, change(12)); // replayed again by the server: ignored
      second.emit("change", 13, change(13));
      second.emit("resync", 900, { reason: "too_far_behind" });
    });
    expect(onChange.mock.calls.map((c) => c[0].id)).toEqual([11, 12, 13]);
    expect(onResync).toHaveBeenCalledTimes(2);
    expect(dataVersion()).toBe(900);
  });
});
