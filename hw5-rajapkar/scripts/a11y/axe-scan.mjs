// HW5 Task 7: axe scans of ReelSchedule, at rest AND in states a default scan never reaches.
//
// Setup once (from the repository root; installs only into this folder, uses your own Google Chrome):
//     npm install --prefix hw5-rajapkar\scripts\a11y
// Run:
//     node hw5-rajapkar\scripts\a11y\axe-scan.mjs https://reel.miniexhibit.app
//
// Writes hw5-rajapkar/evidence/07-accessibility/axe-<view>.json (axe's full result per view) and
// axe-summary.txt (axe version, every violation by impact, per view).
//
// Views:
//   program            the program page at rest, after its data loaded (labeled filters: search, Day, Room, Genre, Status)
//   program-no-results STATEFUL: "zzz" typed into Film title, so the empty state and its Clear filters button show
//   program-filtered   STATEFUL: Day = second festival day and Status = "Canceled only" chosen with the keyboard
//   grid               Rooms by day (time grid)
//   screening          one screening's page (opened by following the first program link)
//   sign-in            the sign-in form
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright-core")); } catch { ({ chromium } = require("playwright")); }
const { default: AxeBuilder } = await import("@axe-core/playwright");
const axeVersion = require("axe-core/package.json").version;

const base = (process.argv[2] || "https://reel.miniexhibit.app").replace(/\/$/, "");
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.env.A11Y_OUT || path.join(here, "..", "..", "evidence", "07-accessibility");
mkdirSync(out, { recursive: true });

// Your installed Chrome by default; A11Y_CHANNEL=none uses Playwright's bundled Chromium instead.
const channel = process.env.A11Y_CHANNEL === "none" ? undefined : process.env.A11Y_CHANNEL || "chrome";
const browser = await chromium.launch({ channel, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

async function loadProgram() {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByText(/^\d+ screenings?$/).first().waitFor({ timeout: 30000 });
}

const views = [
  { name: "program", setup: loadProgram },
  {
    name: "program-no-results",
    setup: async () => {
      await loadProgram();
      await page.getByLabel("Film title").fill("zzz");
      await page.getByText("No screenings match these filters.").waitFor({ timeout: 15000 });
    },
  },
  {
    name: "program-filtered",
    setup: async () => {
      await loadProgram();
      const days = page.getByRole("group", { name: "Day" }).getByRole("radio");
      await days.nth(2).focus();
      await page.keyboard.press("Space");
      await page.getByLabel("Status").selectOption("canceled");
      await page.waitForLoadState("networkidle");
      await page.getByText(/^\d+ screenings?$/).first().waitFor({ timeout: 15000 });
    },
  },
  {
    name: "grid",
    setup: async () => {
      await page.goto(`${base}/grid`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { level: 1, name: "Rooms by day" }).waitFor({ timeout: 30000 });
    },
  },
  {
    name: "screening",
    setup: async () => {
      await loadProgram();
      const link = page.locator('a[href^="/screenings/"]').first();
      const href = await link.getAttribute("href");
      await page.goto(`${base}${href}`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 30000 });
    },
  },
  {
    name: "sign-in",
    setup: async () => {
      await page.goto(`${base}/sign-in`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 30000 });
    },
  },
];

const lines = [];
const started = new Date().toISOString();
lines.push(`# axe scan of ${base}`, `started ${started}`, `axe-core ${axeVersion}, ${channel ? `Chrome (channel ${channel})` : "Playwright Chromium"} ${browser.version()}, viewport 1280x900`, `rules: axe defaults (WCAG 2.0/2.1/2.2 A and AA, plus best practices)`, "");
let total = 0;
for (const v of views) {
  await v.setup();
  const result = await new AxeBuilder({ page }).analyze();
  writeFileSync(path.join(out, `axe-${v.name}.json`), JSON.stringify(result, null, 2));
  const byImpact = {};
  for (const x of result.violations) byImpact[x.impact] = (byImpact[x.impact] || 0) + 1;
  lines.push(`## ${v.name}  (${result.url})`);
  lines.push(`violations: ${result.violations.length} rules ${JSON.stringify(byImpact)}; passes: ${result.passes.length}; incomplete (needs a human): ${result.incomplete.length}`);
  for (const x of result.violations) {
    lines.push(`  [${x.impact}] ${x.id}: ${x.help} (${x.nodes.length} element${x.nodes.length === 1 ? "" : "s"})`);
    for (const n of x.nodes.slice(0, 5)) lines.push(`      ${n.target.join(" ")}  ${n.failureSummary ? n.failureSummary.split("\n")[1]?.trim() ?? "" : ""}`);
  }
  for (const x of result.incomplete) lines.push(`  [needs review] ${x.id}: ${x.help} (${x.nodes.length})`);
  lines.push("");
  total += result.violations.length;
}
lines.push(`total violated rules across views: ${total}`);
writeFileSync(path.join(out, "axe-summary.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
await browser.close();
