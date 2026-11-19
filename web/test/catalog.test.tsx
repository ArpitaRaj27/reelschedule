import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { makeQueryClient } from "../src/App";
import { AuthProvider } from "../src/lib/auth";
import { CatalogPage } from "../src/pages/Catalog";
import { META, ROOMS, json, mockFetch, screening } from "./fixtures";

function renderCatalog(routes: Parameters<typeof mockFetch>[0], url = "/") {
  const mock = mockFetch({
    "GET /api/meta": () => json(META),
    "GET /api/rooms": () => json({ items: ROOMS }),
    "GET /api/genres": () => json({ items: ["Drama", "Science Fiction"] }),
    ...routes,
  });
  vi.stubGlobal("fetch", mock.fn);
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/" element={<CatalogPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return mock;
}

describe("program page", () => {
  it("lists screenings by festival day with festival-local times and room-free time", async () => {
    renderCatalog({
      "GET /api/screenings": () =>
        json({
          items: [screening(), screening({ id: "s2", status: "canceled", film: { ...screening().film, title: "Neon Orchard" } })],
          count: 2,
          page: 1,
          pageSize: 25,
        }),
    });
    const day = await screen.findByRole("region", { name: /friday, november 20/i });
    const rows = within(day).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("18:00")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Room free at 20:00")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Canceled")).toBeInTheDocument();
    expect(screen.getByText("2 screenings")).toBeInTheDocument();
  });

  it("sends the chosen filters to the API", async () => {
    const mock = renderCatalog({ "GET /api/screenings": () => json({ items: [], count: 0, page: 1, pageSize: 25 }) }, "/?genre=Drama");
    const user = userEvent.setup();
    await screen.findByText("0 screenings");
    await user.click(screen.getByRole("radio", { name: "Sat, Nov 21" }));
    await user.selectOptions(screen.getByLabelText("Room"), "room-loft");
    await user.selectOptions(screen.getByLabelText("Status"), "canceled");
    const last = mock.calls.filter((c) => c.path.startsWith("/api/screenings")).at(-1)!;
    const sp = new URL(last.path, "http://x").searchParams;
    expect(Object.fromEntries(sp)).toMatchObject({ genre: "Drama", date: "2026-11-21", roomId: "room-loft", status: "canceled" });
  });

  it("shows what's on next, from /api/status", async () => {
    renderCatalog({
      "GET /api/screenings": () => json({ items: [screening()], count: 1, page: 1, pageSize: 25 }),
      "GET /api/status": () =>
        json({
          festival: "Lakeshore Film Festival",
          timezone: "America/Chicago",
          generatedAt: "2026-11-17T17:00:00Z",
          nowShowing: [],
          nextUp: [{ id: "s1", title: "The Quiet Harbor", room: "Main Hall", venue: "Harborview", startsAt: "2026-11-21T00:00:00.000Z", endsAt: "2026-11-21T01:45:00.000Z", occupiedUntil: "2026-11-21T02:00:00.000Z" }],
          totals: { scheduled: 8, canceled: 0, rooms: 4, roomsInUseNow: 0 },
        }),
    });
    // The strip's box is there from the first render (reserved space), before /api/status answers.
    const strip = screen.getByRole("region", { name: /now showing and next up/i });
    expect(within(strip).getByText("Now showing")).toBeInTheDocument();
    expect(within(strip).getByText("Next up")).toBeInTheDocument();
    expect(await within(strip).findByRole("link", { name: "The Quiet Harbor" })).toHaveAttribute("href", "/screenings/s1");
    expect(within(strip).getByText("Fri 18:00")).toBeInTheDocument(); // another day than generatedAt, so the weekday shows
    expect(within(strip).getByText("Nothing is showing right now.")).toBeInTheDocument();
  });

  it("keeps the strip to 3 rows per column: extra screenings collapse into 'and N more'", async () => {
    const item = (i: number) => ({ id: `n${i}`, title: `Film ${i}`, room: `Room ${i}`, venue: "Harborview", startsAt: "2026-11-21T00:00:00.000Z", endsAt: "2026-11-21T01:45:00.000Z", occupiedUntil: "2026-11-21T02:00:00.000Z" });
    renderCatalog({
      "GET /api/screenings": () => json({ items: [], count: 0, page: 1, pageSize: 25 }),
      "GET /api/status": () =>
        json({
          festival: "Lakeshore Film Festival",
          timezone: "America/Chicago",
          generatedAt: "2026-11-21T00:30:00Z",
          nowShowing: [1, 2, 3, 4].map(item),
          nextUp: [5, 6, 7, 8, 9].map(item),
          totals: { scheduled: 9, canceled: 0, rooms: 4, roomsInUseNow: 4 },
        }),
    });
    const strip = screen.getByRole("region", { name: /now showing and next up/i });
    const more = await within(strip).findByRole("link", { name: "And 2 more: see all rooms today" });
    expect(more).toHaveAttribute("href", "/grid?date=2026-11-20");
    expect(within(strip).getAllByText("18:00")).toHaveLength(3); // today's screenings show the time only
    const [now, next] = within(strip).getAllByRole("list");
    expect(within(now!).getAllByRole("listitem")).toHaveLength(3);
    expect(within(next!).getAllByRole("listitem")).toHaveLength(3);
  });

  it("explains an empty result and offers to clear filters", async () => {
    renderCatalog({ "GET /api/screenings": () => json({ items: [], count: 0, page: 1, pageSize: 25 }) }, "/?q=zzz");
    expect(await screen.findByText("No screenings match these filters.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
  });

  it("keeps keyboard focus when Clear filters removes itself: focus moves to the first filter", async () => {
    renderCatalog({ "GET /api/screenings": () => json({ items: [], count: 0, page: 1, pageSize: 25 }) }, "/?q=zzz");
    const user = userEvent.setup();
    await screen.findByText("No screenings match these filters.");
    const buttons = screen.getAllByRole("button", { name: "Clear filters" });
    buttons.at(-1)!.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Film title")).toHaveFocus(); // not <body>
  });

  it("shows what went wrong, a retry button and the request id when the API fails", async () => {
    renderCatalog({ "GET /api/screenings": () => json({ error: { code: "internal_error", message: "Unexpected server error", requestId: "req-9" } }, 500) });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unexpected server error");
    expect(alert).toHaveTextContent("req-9");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
