import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Timeline } from "../src/components/Timeline";

// WCAG 2.5.3 Label in Name (axe rule label-content-name-mismatch, found in the HW5 Task 7 scan):
// a voice-control user says the words they can see, so a control's accessible name must contain its
// visible text. The timeline blocks carry an aria-label with more detail; it has to START with what is shown.
describe("timeline blocks", () => {
  const tz = "America/Chicago";
  const item = {
    id: "s1",
    title: "The Quiet Harbor",
    startsAt: "2026-11-21T00:00:00.000Z", // 18:00 in Chicago on Nov 20
    endsAt: "2026-11-21T01:45:00.000Z",
    occupiedUntil: "2026-11-21T02:00:00.000Z",
  };

  it("names each block with its visible text first, then the details only the shape shows", () => {
    render(
      <MemoryRouter>
        <Timeline
          day="2026-11-20"
          tz={tz}
          label="Main Hall, Friday"
          rows={[
            {
              id: "r1",
              label: "Main Hall",
              items: [
                { ...item, kind: "scheduled", href: "/screenings/s1" },
                { ...item, id: "s2", title: "Neon Orchard", startsAt: "2026-11-21T02:15:00.000Z", endsAt: "2026-11-21T03:30:00.000Z", occupiedUntil: "2026-11-21T03:45:00.000Z", kind: "canceled", href: "/screenings/s2" },
              ],
            },
          ]}
        />
      </MemoryRouter>,
    );
    const block = screen.getByRole("link", { name: "18:00 The Quiet Harbor, until 19:45, room free at 20:00" });
    const visible = block.textContent!.trim(); // what a voice user reads off the block
    expect(visible).toBe("18:00 The Quiet Harbor");
    expect(block.getAttribute("aria-label")!.startsWith(visible)).toBe(true);
    expect(screen.getByRole("link", { name: "20:15 Neon Orchard, until 21:30, canceled" })).toBeInTheDocument();
  });
});
