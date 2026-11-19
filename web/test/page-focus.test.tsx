import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { PageFocus } from "../src/components/PageFocus";

/** A page whose heading only appears after its data "loads", like the screening page. */
function SlowPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 30);
    return () => clearTimeout(t);
  }, []);
  return ready ? <h1>The Quiet Harbor</h1> : <p role="status">Loading the screening…</p>;
}

function renderApp() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <PageFocus />
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <h1>Program</h1>
                <Link to="/screenings/s1">The Quiet Harbor</Link>
                <Link to="/?q=harbor">Filter</Link>
              </>
            }
          />
          <Route path="/screenings/:id" element={<SlowPage />} />
        </Routes>
      </main>
    </MemoryRouter>,
  );
}

// HW5 Task 7: following a link in a single-page app used to leave focus on <body> and the tab title unchanged.
describe("page changes", () => {
  it("names the tab after the page on first load without moving focus", async () => {
    renderApp();
    expect(document.title).toBe("Program · ReelSchedule");
    expect(screen.getByRole("heading", { name: "Program" })).not.toHaveFocus();
  });

  it("moves focus to the new page's heading once it appears, and renames the tab", async () => {
    renderApp();
    const user = userEvent.setup();
    screen.getByRole("link", { name: "The Quiet Harbor" }).focus();
    await user.keyboard("{Enter}");
    const heading = await screen.findByRole("heading", { name: "The Quiet Harbor" });
    expect(heading).toHaveFocus();
    expect(document.title).toBe("The Quiet Harbor · ReelSchedule");
  });

  it("does not move focus when only the query string changes (filters)", async () => {
    renderApp();
    const user = userEvent.setup();
    const filter = screen.getByRole("link", { name: "Filter" });
    filter.focus();
    await user.keyboard("{Enter}");
    expect(filter).toHaveFocus();
  });
});
