import { useState, type FormEvent } from 'react';
import { signIn, type AuthUser } from '../lib/auth';
import Logo from './Logo';

interface LoginScreenProps {
  onAuthenticated: (user: AuthUser) => void;
  onTrialRequest: () => void;
  serviceError?: string | null;
}

/** Map raw auth failures to specific, actionable messages (Phase 15). */
function loginErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : '';
  if (/HTTP 401|Invalid username or password/i.test(message)) {
    return 'Incorrect username or password. Check your credentials and try again.';
  }
  if (/HTTP 429|too many/i.test(message)) {
    return 'Too many sign-in attempts. Wait a few minutes and try again.';
  }
  if (/HTTP 403|origin/i.test(message)) {
    return 'This login isn’t available from this address. Open SportsEdge from its official URL.';
  }
  if (/Failed to fetch|NetworkError|unavailable/i.test(message)) {
    return 'Can’t reach the sign-in service right now. Check your connection and retry shortly.';
  }
  if (/configuration|AUTH_USERS/i.test(message)) {
    return 'Sign-in is temporarily misconfigured. The team has been notified — please try again later.';
  }
  return message || 'Could not sign in. Please retry.';
}

export default function LoginScreen({ onAuthenticated, onTrialRequest, serviceError }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(serviceError ?? null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !username.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      onAuthenticated(await signIn(username.trim(), password));
    } catch (reason) {
      setError(loginErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-ink px-4 py-10">
      <section className="grid w-full max-w-4xl overflow-hidden border border-line bg-panel md:grid-cols-[0.9fr_1.1fr]">
        <div className="border-b border-line bg-ink p-6 md:border-b-0 md:border-r sm:p-8">
          <div className="mb-8">
            <Logo size={44} wordmark className="text-3xl" />
          </div>
          <h2 className="display text-4xl text-head">A research desk, not a tip feed.</h2>
          <p className="mt-4 text-sm leading-relaxed text-frost2">
            Sign in to inspect stored edges, test a prop line against official logs, and keep a pick’s identity through the slip and the ledger.
          </p>
        </div>
        <div className="p-6 sm:p-8">
        <h3 className="text-lg font-semibold text-head">Sign in</h3>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-frost">Username</span>
            <input
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
              className="min-h-11 w-full rounded-xl border border-line bg-panel2/80 px-3.5 py-3 text-sm text-head outline-none transition placeholder:text-muted focus:border-edge/60 focus:ring-2 focus:ring-edge/15 disabled:opacity-60"
              placeholder="Your username"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-frost">Password</span>
            <span className="relative block">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                className="min-h-11 w-full rounded-xl border border-line bg-panel2/80 px-3.5 py-3 pr-16 text-sm text-head outline-none transition placeholder:text-muted focus:border-edge/60 focus:ring-2 focus:ring-edge/15 disabled:opacity-60"
                placeholder="Your password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-2 my-auto flex h-8 items-center rounded-md px-2 text-[10px] font-bold uppercase tracking-wider text-frost2 transition-colors hover:bg-line/50 hover:text-frost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/40"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>

          {error && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs leading-relaxed text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !username.trim() || !password}
            className="flex min-h-11 w-full items-center justify-center rounded-xl bg-edge px-4 py-3 text-sm font-extrabold text-ink shadow-[0_0_22px_rgba(21,255,194,0.22)] transition hover:bg-edge2 focus:outline-none focus:ring-2 focus:ring-edge/50 focus:ring-offset-2 focus:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <svg viewBox="0 0 24 24" className="mr-2 h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M12 3a9 9 0 019 9" strokeLinecap="round" />
                  <path d="M21 12a9 9 0 11-9-9" opacity="0.25" />
                </svg>
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <p className="mt-4 text-center text-[10px] text-muted">
          Forgot your password?{' '}
          <span className="text-frost2">Contact your account administrator to reset it.</span>
        </p>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-line/70" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-frost2/70">or</span>
          <span className="h-px flex-1 bg-line/70" />
        </div>

        <button
          type="button"
          onClick={onTrialRequest}
          className="flex min-h-11 w-full items-center justify-center rounded-xl border border-edge/40 bg-edge/10 px-4 py-3 text-sm font-extrabold text-edge transition hover:bg-edge/20 focus:outline-none focus:ring-2 focus:ring-edge/50 focus:ring-offset-2 focus:ring-offset-panel"
        >
          Start free 7-day trial
        </button>

        <p className="mt-5 text-[11px] leading-relaxed text-frost2">
          Sessions use encrypted transport and an HTTP-only secure cookie.
        </p>
        </div>
      </section>
    </main>
  );
}
