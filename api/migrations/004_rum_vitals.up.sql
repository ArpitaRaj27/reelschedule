-- Real-user monitoring pilot (HW5 Task 5c): Core Web Vitals beacons from the web app.
-- Privacy-minimised: no URL/query, user agent, IP or user id. One row per page view + metric id,
-- so repeated reports of the same metric (web-vitals re-reports on visibility change) keep the latest.
CREATE TABLE rum_vitals (
  page_view_id    text        NOT NULL CHECK (length(page_view_id) BETWEEN 1 AND 100),
  metric_id       text        NOT NULL CHECK (length(metric_id) BETWEEN 1 AND 100),
  name            text        NOT NULL CHECK (name IN ('LCP', 'INP', 'CLS', 'FCP', 'TTFB')),
  value           double precision NOT NULL CHECK (value >= 0),
  rating          text        CHECK (rating IN ('good', 'needs-improvement', 'poor')),
  cohort          text        NOT NULL CHECK (cohort IN ('desktop', 'mobile')),
  navigation_type text,
  effective_type  text,
  target          text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_view_id, metric_id)
);
CREATE INDEX rum_vitals_name_cohort_idx ON rum_vitals (name, cohort);
