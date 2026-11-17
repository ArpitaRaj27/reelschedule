/**
 * Real-user monitoring pilot (HW5 Task 5c). Adapted from the course sample
 * weeks/week05/samples/web-vitals-rum.js, ported to strict TypeScript.
 *
 * Captures LCP, INP and CLS (plus FCP and TTFB) with web-vitals' attribution build, so a slow
 * value comes with WHICH element caused it, and beacons each report to our own same-origin
 * collector, POST /api/vitals. sendBeacon survives the page closing; fetch(keepalive) is the fallback.
 *
 * Privacy: no URL or query string (it could hold a token), no user id. The server derives the
 * desktop/mobile cohort from the viewport and keeps the latest value per page view + metric id.
 * INP is only reported after an interaction: a session nobody clicked in has no INP sample.
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB, type MetricWithAttribution } from "web-vitals/attribution";
import { apiUrl } from "./api";

const ENDPOINT = apiUrl("/api/vitals");

/** One id per page view, so repeated reports of a metric can be deduplicated server-side. */
export const pageViewId: string = globalThis.crypto?.randomUUID?.() ?? `pv-${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface NetworkInformation {
  effectiveType?: string;
}

function targetOf(metric: MetricWithAttribution): string | null {
  switch (metric.name) {
    case "LCP":
      return metric.attribution.target ?? null;
    case "INP":
      return metric.attribution.interactionTarget || null;
    case "CLS":
      return metric.attribution.largestShiftTarget ?? null;
    default:
      return null;
  }
}

export function payload(metric: MetricWithAttribution): string {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    pageViewId,
    navigationType: metric.navigationType,
    effectiveType: connection?.effectiveType ?? null,
    viewport: `${Math.round(innerWidth)}x${Math.round(innerHeight)}`,
    target: targetOf(metric)?.slice(0, 200) ?? null,
  });
}

function send(metric: MetricWithAttribution): void {
  const body = payload(metric);
  const queued = navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }));
  if (!queued) {
    fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {
      /* a measurement must never break the application */
    });
  }
}

export function startRum(): void {
  onLCP(send);
  onINP(send);
  onCLS(send);
  onFCP(send);
  onTTFB(send);
}
