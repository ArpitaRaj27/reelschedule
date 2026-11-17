import { describe, expect, it } from "vitest";
import type { MetricWithAttribution } from "web-vitals/attribution";
import { pageViewId, payload } from "../src/lib/rum";

describe("RUM beacon payload", () => {
  it("names the responsible element and carries no URL, query string or user identity", () => {
    const metric = {
      name: "LCP",
      value: 1834.2,
      rating: "good",
      delta: 1834.2,
      id: "v5-1-1",
      entries: [],
      navigationType: "navigate",
      attribution: { target: "main > h1" },
    } as unknown as MetricWithAttribution;
    history.replaceState(null, "", "/screenings/abc?code=SECRET");
    const body = JSON.parse(payload(metric));
    expect(body).toMatchObject({ name: "LCP", value: 1834.2, id: "v5-1-1", pageViewId, target: "main > h1", navigationType: "navigate" });
    expect(body.viewport).toMatch(/^\d+x\d+$/);
    expect(JSON.stringify(body)).not.toMatch(/SECRET|screenings|url/);
  });
});
