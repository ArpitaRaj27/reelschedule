import type { ReactNode } from "react";
import { ApiError, describeError } from "../lib/api";

export function Loading({ label = "Loading the schedule", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="visually-hidden">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="loading-row" aria-hidden="true" />
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const ref = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div className="error-notice" role="alert">
      <p>{describeError(error)}</p>
      {onRetry && (
        <button type="button" className="button secondary" onClick={onRetry}>
          Try again
        </button>
      )}
      {ref && <p className="reference">Reference for support: {ref}</p>}
    </div>
  );
}
