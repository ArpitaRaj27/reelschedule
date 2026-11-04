import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, configureAuth } from "./api";
import type { Me } from "./types";

/**
 * Who is signed in. The API decides what a token may do (roles + scopes are checked on
 * every write); the UI only uses /api/me to choose what to show.
 *
 * Development mode: paste a locally signed token (npm run dev-token -w api -- programmer).
 * The token lives in sessionStorage for this tab only. The Entra ID (Auth Code + PKCE)
 * sign-in replaces this provider in a later stage without changing the rest of the app.
 */

const KEY = "reelschedule.devToken";

function readStored(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function writeStored(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: stay signed in for this page view only */
  }
}

export type AuthStatus = "signed-out" | "checking" | "signed-in";

interface AuthValue {
  status: AuthStatus;
  me: Me | null;
  canProgram: boolean;
  notice: string | null;
  signIn(token: string): Promise<Me>;
  signOut(): void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const tokenRef = useRef<string | null>(readStored());
  const [token, setToken] = useState<string | null>(tokenRef.current);
  const [notice, setNotice] = useState<string | null>(null);

  const me = useQuery({
    queryKey: ["me", token],
    queryFn: ({ signal }) => api<Me>("/api/me", { auth: true, signal }),
    enabled: token !== null,
    retry: false,
    staleTime: 60_000,
  });

  const signOut = useCallback(
    (reason?: "expired") => {
      writeStored(null);
      tokenRef.current = null;
      setToken(null);
      qc.removeQueries({ queryKey: ["me"] });
      setNotice(reason === "expired" ? "Your sign-in expired. Sign in again to keep making changes." : null);
    },
    [qc],
  );

  useEffect(() => {
    configureAuth(
      () => tokenRef.current,
      () => signOut("expired"),
    );
  }, [signOut]);

  const signIn = useCallback(
    async (raw: string) => {
      const candidate = raw.trim().replace(/^Bearer\s+/i, "");
      const profile = await api<Me>("/api/me", { token: candidate });
      writeStored(candidate);
      tokenRef.current = candidate;
      qc.setQueryData(["me", candidate], profile);
      setToken(candidate);
      setNotice(null);
      return profile;
    },
    [qc],
  );

  const value = useMemo<AuthValue>(() => {
    const status: AuthStatus = token === null ? "signed-out" : me.isPending ? "checking" : me.data ? "signed-in" : "signed-out";
    return {
      status,
      me: me.data ?? null,
      canProgram: Boolean(me.data?.canProgram),
      notice,
      signIn,
      signOut: () => signOut(),
    };
  }, [token, me.isPending, me.data, notice, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
