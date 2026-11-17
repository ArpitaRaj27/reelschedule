import { z } from "zod";
import type { Db } from "../db.js";

/** POST /api/vitals body, as sent by web/src/lib/rum.ts (adapted from the course web-vitals-rum.js). */
export const VitalInput = z.object({
  name: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
  value: z.number().finite().nonnegative().max(600_000),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  id: z.string().min(1).max(100),
  pageViewId: z.string().min(1).max(100),
  navigationType: z.string().max(50).optional(),
  effectiveType: z.string().max(20).nullable().optional(),
  viewport: z.string().regex(/^\d{1,5}x\d{1,5}$/),
  target: z.string().max(200).nullable().optional(),
});
export type VitalInput = z.infer<typeof VitalInput>;

/** Desktop and mobile are reported separately (HW5 5c); the split is by viewport width. */
export function cohortOf(viewport: string): "desktop" | "mobile" {
  const width = Number(viewport.split("x")[0]);
  return width < 768 ? "mobile" : "desktop";
}

export async function recordVital(db: Db, v: VitalInput): Promise<void> {
  await db.query(
    `INSERT INTO rum_vitals (page_view_id, metric_id, name, value, rating, cohort, navigation_type, effective_type, target)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (page_view_id, metric_id) DO UPDATE
       SET value = EXCLUDED.value, rating = EXCLUDED.rating, received_at = now()`,
    [v.pageViewId, v.id, v.name, v.value, v.rating ?? null, cohortOf(v.viewport), v.navigationType ?? null, v.effectiveType ?? null, v.target ?? null],
  );
}

export interface VitalSummaryRow {
  cohort: string;
  name: string;
  n: number;
  pageViews: number;
  p75: number;
}

/** p75 per cohort and metric, nearest-rank like the course rum-collector (sorted[ceil(n*0.75)-1]). */
export async function summarizeVitals(db: Db): Promise<{ label: string; rows: VitalSummaryRow[] }> {
  const { rows } = await db.query<VitalSummaryRow>(
    `SELECT cohort, name, count(*)::int AS n, count(DISTINCT page_view_id)::int AS "pageViews",
            (array_agg(value ORDER BY value))[ceil(count(*) * 0.75)::int] AS p75
       FROM rum_vitals GROUP BY cohort, name ORDER BY cohort, name`,
  );
  return { label: "Small convenience pilot; not CrUX or representative field data", rows };
}
