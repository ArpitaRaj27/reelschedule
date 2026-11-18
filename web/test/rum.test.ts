import { describe, expect, it } from "vitest";
import type { MetricWithAttribution } from "web-vitals/attribution";
import { isAutomated, pageViewId, payload } from "../src/lib/rum";

describe("RUM keeps lab and automated browsers out of the field data", () => {
  const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
  it.each([
    ["Lighthouse mobile run", "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse", false],
    ["headless Chrome", chrome.replace("Chrome/", "HeadlessChrome/"), false],
    ["WebDriver-controlled browser", chrome, true],
    ["Claude desktop browser pane", chrome.replace("Chrome/", "Claude/5.11492.5 Chrome/"), false],
  ])("excludes a %s", (_label, userAgent, webdriver) => {
    expect(isAutomated({ userAgent, webdriver })).toBe(true);
  });
  it("counts an ordinary Chrome or phone browser", () => {
    expect(isAutomated({ userAgent: chrome, webdriver: false })).toBe(false);
    expect(isAutomated({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" })).toBe(false);
  });
});

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
