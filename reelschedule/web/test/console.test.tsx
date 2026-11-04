import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { makeQueryClient } from "../src/App";
import { AnnouncerProvider } from "../src/components/Announcer";
import { AuthProvider } from "../src/lib/auth";
import { ConsolePage } from "../src/pages/Console";
import { FILMS, META, ROOMS, json, mockFetch, screening } from "./fixtures";

const PROGRAMMER = { sub: "prog-1", roles: ["Festival.Programmer"], scopes: ["Schedule.Read", "Schedule.Write"], canProgram: true };
const VIEWER = { sub: "viewer-1", roles: ["Festival.Viewer"], scopes: ["Schedule.Read"], canProgram: false };

function renderConsole(me: object | null, extra: Parameters<typeof mockFetch>[0] = {}) {
  if (me) sessionStorage.setItem("reelschedule.devToken", "dev-token-for-tests");
  const mock = mockFetch({
    "GET /api/me": () => json(me),
    "GET /api/meta": () => json(META),
    "GET /api/rooms": () => json({ items: ROOMS }),
    "GET /api/films": () => json({ items: FILMS }),
    "GET /api/rooms/room-main/schedule": () => json({ room: { id: "room-main", name: "Main Hall", seats: 320, venue: "Harborview" }, screenings: [screening()] }),
    ...extra,
  });
  vi.stubGlobal("fetch", mock.fn);
  const client = makeQueryClient();
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter>
          <AnnouncerProvider>
            <ConsolePage />
          </AnnouncerProvider>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return mock;
}

async function fillForm(time: string) {
  const user = userEvent.setup();
  await screen.findByRole("option", { name: /Neon Orchard/ });
  await user.selectOptions(screen.getByLabelText("Film"), "film-orchard");
  await user.selectOptions(screen.getByLabelText("Room"), "room-main");
  const start = screen.getByLabelText("Starts at");
  await user.clear(start);
  await user.type(start, time);
  return user;
}

describe("programmer console", () => {
  it("asks signed-out visitors to sign in", async () => {
    renderConsole(null);
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("tells a viewer they can't change the schedule (the API enforces it regardless)", async () => {
    renderConsole(VIEWER);
    expect(await screen.findByText(/can view the program but can't change it/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule screening" })).not.toBeInTheDocument();
  });

  it("previews a 19:50 start as overlapping the 18:00 screening that holds the room until 20:00", async () => {
    const mock = renderConsole(PROGRAMMER, {
      "POST /api/screenings/preview": () =>
        json({
          film: { id: "film-orchard", title: "Neon Orchard" },
          roomId: "room-main",
          startsAt: "2026-11-21T01:50:00.000Z",
          endsAt: "2026-11-21T03:22:00.000Z",
          occupiedUntil: "2026-11-21T03:37:00.000Z",
          runtimeMinutes: 92,
          bufferMinutes: 15,
          conflicts: [{ id: "s1", title: "The Quiet Harbor", startsAt: "2026-11-21T00:00:00.000Z", occupiedUntil: "2026-11-21T02:00:00.000Z" }],
          ok: false,
        }),
    });
    await fillForm("19:50");
    expect(await screen.findByText("Overlaps with:")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "The Quiet Harbor" }).closest("li")).toHaveTextContent("room busy until 20:00");
    expect(screen.getByRole("img", { name: /Neon Orchard \(new, overlaps\), 19:50 to 21:22, room free at 21:37/ })).toBeInTheDocument();
    const preview = mock.calls.find((c) => c.path === "/api/screenings/preview")!;
    expect(JSON.parse(String(preview.init.body))).toEqual({ filmId: "film-orchard", roomId: "room-main", startsAt: "2026-11-20T19:50:00-06:00" });
    expect(new Headers(preview.init.headers).get("authorization")).toBe("Bearer dev-token-for-tests");
  });

  it("shows the server's 409 conflict when someone else booked the slot first", async () => {
    renderConsole(PROGRAMMER, {
      "POST /api/screenings/preview": () =>
        json({ film: { id: "film-orchard", title: "Neon Orchard" }, roomId: "room-main", startsAt: "2026-11-21T02:00:00.000Z", endsAt: "2026-11-21T03:32:00.000Z", occupiedUntil: "2026-11-21T03:47:00.000Z", runtimeMinutes: 92, bufferMinutes: 15, conflicts: [], ok: true }),
      "POST /api/screenings": () =>
        json(
          {
            error: {
              code: "schedule_conflict",
              message: "The room is already occupied",
              details: { conflicts: [{ id: "s9", title: "Small Hours", startsAt: "2026-11-21T02:00:00.000Z", occupiedUntil: "2026-11-21T03:39:00.000Z" }] },
              requestId: "r1",
            },
          },
          409,
        ),
    });
    const user = await fillForm("20:00");
    expect(await screen.findByText("No overlaps. Ready to schedule.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Schedule screening" }));
    expect(await screen.findByText("Not scheduled: the room is busy for part of that time.")).toBeInTheDocument();
    expect(screen.getByText(/Someone booked this slot a moment ago/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Small Hours" })).toBeInTheDocument();
  });
});
