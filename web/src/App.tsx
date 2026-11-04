import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router";
import { AnnouncerProvider, useAnnounce } from "./components/Announcer";
import { ApiError } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { useLiveUpdates, type LiveStatus } from "./lib/live";
import { useMeta } from "./lib/queries";
import { clockTime } from "./lib/time";
import type { ChangeEvent, Screening } from "./lib/types";
import { CatalogPage } from "./pages/Catalog";
import { ConsolePage } from "./pages/Console";
import { DayGridPage, RoomPage } from "./pages/DayGrid";
import { ScreeningPage } from "./pages/ScreeningPage";
import { SignInPage } from "./pages/SignIn";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        // Don't retry answers the server gave on purpose (400/401/403/404/409); do retry outages.
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

export function App({ client }: { client?: QueryClient }) {
  const [qc] = useState(() => client ?? makeQueryClient());
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <AnnouncerProvider>
            <Shell />
          </AnnouncerProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

const VERB: Record<string, string> = {
  "screening.created": "was added",
  "screening.rescheduled": "was moved",
  "screening.canceled": "was canceled",
};

function Shell() {
  const qc = useQueryClient();
  const announce = useAnnounce();
  const meta = useMeta();
  const { status, me, signOut, canProgram } = useAuth();

  const refreshAll = useCallback(() => {
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" && q.queryKey[0] !== "tmdb-search" });
  }, [qc]);

  const live = useLiveUpdates({
    onChange: (e: ChangeEvent) => {
      void qc.invalidateQueries({ queryKey: ["screenings"] });
      void qc.invalidateQueries({ queryKey: ["room-schedule"] });
      void qc.invalidateQueries({ queryKey: ["preview"] });
      void qc.invalidateQueries({ queryKey: ["meta"] });
      if (e.screeningId) void qc.invalidateQueries({ queryKey: ["screening", e.screeningId] });
      const s = e.payload as Partial<Screening> | null;
      if (s?.film?.title && VERB[e.type]) {
        const at = s.startsAt && e.type !== "screening.canceled" ? ` (${clockTime(s.startsAt, meta.timezone)}, ${s.room?.name ?? "room"})` : "";
        announce(`${s.film.title} ${VERB[e.type]}${at}.`);
      }
    },
    onResync: refreshAll,
  });

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="masthead">
        <div className="masthead-inner">
          <Link to="/" className="wordmark" aria-label="ReelSchedule, program home">
            <span className="wordmark-name">ReelSchedule</span>
            <span className="wordmark-festival">{meta.festivalName}</span>
          </Link>
          <nav aria-label="Main" className="nav">
            <NavLink to="/" end>
              Program
            </NavLink>
            <NavLink to="/grid">Rooms by day</NavLink>
            {canProgram && <NavLink to="/console">Schedule</NavLink>}
          </nav>
          <div className="masthead-tools">
            <LiveBadge status={live} />
            {status === "signed-in" && me ? (
              <button type="button" className="button link" onClick={signOut} title={`Signed in as ${me.sub}`}>
                Sign out
              </button>
            ) : (
              <NavLink to="/sign-in">Sign in</NavLink>
            )}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<CatalogPage />} />
          <Route path="/screenings/:id" element={<ScreeningPage />} />
          <Route path="/grid" element={<DayGridPage />} />
          <Route path="/rooms/:id" element={<RoomPage />} />
          <Route path="/console" element={<ConsolePage />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route
            path="*"
            element={
              <div className="page-narrow">
                <h1>Page not found</h1>
                <p>
                  There's nothing at this address. <Link to="/">Go to the program</Link>
                </p>
              </div>
            }
          />
        </Routes>
      </main>
      <footer className="site-footer">
        <p>{meta.festivalName} is a fictional festival made for a course project. Times are shown in festival time ({meta.timezone.replace("_", " ")}).</p>
      </footer>
    </>
  );
}

const LIVE_TEXT: Record<LiveStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

function LiveBadge({ status }: { status: LiveStatus }) {
  return (
    <span className={`live-badge is-${status}`} title={status === "live" ? "Changes appear here as soon as they're saved" : "Live updates paused; showing the last loaded schedule"}>
      <span className="live-dot" aria-hidden="true" />
      {LIVE_TEXT[status]}
    </span>
  );
}
