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

  it("explains an empty result and offers to clear filters", async () => {
    renderCatalog({ "GET /api/screenings": () => json({ items: [], count: 0, page: 1, pageSize: 25 }) }, "/?q=zzz");
    expect(await screen.findByText("No screenings match these filters.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
  });

  it("shows what went wrong, a retry button and the request id when the API fails", async () => {
    renderCatalog({ "GET /api/screenings": () => json({ error: { code: "internal_error", message: "Unexpected server error", requestId: "req-9" } }, 500) });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unexpected server error");
    expect(alert).toHaveTextContent("req-9");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
