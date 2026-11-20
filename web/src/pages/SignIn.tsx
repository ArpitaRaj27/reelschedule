import { useId, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError, describeError } from "../lib/api";
import { useAuth } from "../lib/auth";

/** A pasted dev token is a few hundred characters; anything this short was cut off. */
const MIN_TOKEN_LENGTH = 20;

/** "invalid_token" elsewhere means a sign-in expired; here the token was never accepted, so say that. */
function signInError(err: unknown): string {
  if (err instanceof ApiError && err.code === "invalid_token") return `That token wasn't accepted. The server said: ${err.message.replace(/\.$/, "")}.`;
  return describeError(err);
}

/** Development sign-in: paste a token minted by `npm run dev-token -w api -- programmer`. */
export function SignInPage() {
  const { status, me, signIn, signOut, notice } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/console";

  // Keyboard and screen-reader behavior (HW5 Task 7, found by hand, not by axe):
  // - The button is never `disabled`. A disabled button can't be reached with Tab (so a short token left a keyboard
  //   user with no way to learn why), and disabling the focused button while "Checking…" dropped focus to <body>.
  // - An error is tied to the field (aria-invalid + aria-describedby) and focus returns to the field, so it is read
  //   out with the field's name, and the user is already where the fix happens.
  const fail = (message: string) => {
    setError(message);
    field.current?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (token.trim().length < MIN_TOKEN_LENGTH) {
      fail("That's too short to be a token. Paste the whole token the command printed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const profile = await signIn(token);
      setToken("");
      navigate(profile.canProgram ? safeNext : "/");
    } catch (err) {
      fail(signInError(err));
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
          <textarea
            ref={field}
            id={id}
            rows={5}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error ${id}-help` : `${id}-help`}
          />
          <small id={`${id}-help`}>Kept for this browser tab only and cleared when you sign out.</small>
        </div>
        {error && (
          <p id={`${id}-error`} className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="button primary" aria-disabled={busy || undefined}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
