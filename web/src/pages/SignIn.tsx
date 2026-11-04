import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { describeError } from "../lib/api";
import { useAuth } from "../lib/auth";

/** Development sign-in: paste a token minted by `npm run dev-token -w api -- programmer`. */
export function SignInPage() {
  const { status, me, signIn, signOut, notice } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/console";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const profile = await signIn(token);
      setToken("");
      navigate(profile.canProgram ? safeNext : "/");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  if (status === "signed-in" && me) {
    return (
      <div className="page-narrow">
        <h1>Signed in</h1>
        <p>
          You're signed in as <strong>{me.sub}</strong>
          {me.canProgram ? ", with permission to change the schedule." : ", with view-only access."}
        </p>
        <div className="actions">
          {me.canProgram && (
            <Link className="button primary" to="/console">
              Schedule a screening
            </Link>
          )}
          <button type="button" className="button secondary" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-narrow">
      <h1>Sign in</h1>
      {notice && <p className="form-error">{notice}</p>}
      <p>
        This local build uses development tokens. In a terminal, run <code>npm run dev-token -w api -- programmer</code> and paste the
        token it prints.
      </p>
      <form className="panel" onSubmit={submit}>
        <div className="field">
          <label htmlFor={id}>Access token</label>
          <textarea id={id} rows={5} value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} autoComplete="off" required />
          <small>Kept for this browser tab only and cleared when you sign out.</small>
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button primary" disabled={busy || token.trim().length < 20}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
