import { useState, type FormEvent } from 'react';
import { signIn, type AuthUser } from '../lib/auth';

interface LoginScreenProps {
  onAuthenticated: (user: AuthUser) => void;
  onTrialRequest: () => void;
  serviceError?: string | null;
}

export default function LoginScreen({ onAuthenticated, onTrialRequest, serviceError }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
      setError(reason instanceof Error ? reason.message : 'Could not sign in. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-full items-center justify-center overflow-hidden bg-ink px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(21,255,194,0.13),transparent_42%)]" />
      <section className="relative w-full max-w-md overflow-hidden rounded-3xl border border-line/80 bg-panel/95 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-edge via-edge2 to-teal3 shadow-[0_0_26px_rgba(21,255,194,0.32)]">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 17l5-5 4 3 6-8" />
              <path d="M14 7h4v4" />
            </svg>
          </div>
          <div>
            <h1 className="font-display text-xl font-extrabold tracking-tight text-white">SportsEdge</h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-frost2">Secure analyst access</p>
          </div>
        </div>

        <div className="mb-6">
          <h2 className="font-display text-2xl font-bold tracking-tight text-head">Sign in</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-frost2">
            Use your administrator or shared tester credentials to access live recommendations and tracked bets.
          </p>
        </div>

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
              className="w-full rounded-xl border border-line bg-panel2/80 px-3.5 py-3 text-sm text-head outline-none transition placeholder:text-muted focus:border-edge/60 focus:ring-2 focus:ring-edge/15 disabled:opacity-60"
              placeholder="Account username"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-frost">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              className="w-full rounded-xl border border-line bg-panel2/80 px-3.5 py-3 text-sm text-head outline-none transition placeholder:text-muted focus:border-edge/60 focus:ring-2 focus:ring-edge/15 disabled:opacity-60"
              placeholder="Password"
              required
            />
          </label>

          {error && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs leading-relaxed text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !username.trim() || !password}
            className="flex w-full items-center justify-center rounded-xl bg-edge px-4 py-3 text-sm font-extrabold text-ink shadow-[0_0_22px_rgba(21,255,194,0.22)] transition hover:bg-edge2 focus:outline-none focus:ring-2 focus:ring-edge/50 focus:ring-offset-2 focus:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in securely'}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-line/70" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-frost2/70">or</span>
          <span className="h-px flex-1 bg-line/70" />
        </div>

        <button
          type="button"
          onClick={onTrialRequest}
          className="flex w-full items-center justify-center rounded-xl border border-edge/40 bg-edge/10 px-4 py-3 text-sm font-extrabold text-edge transition hover:bg-edge/20 focus:outline-none focus:ring-2 focus:ring-edge/50 focus:ring-offset-2 focus:ring-offset-panel"
        >
          Start free 7-day trial
        </button>

        <p className="mt-5 text-center text-[10px] leading-relaxed text-frost2/75">
          Sessions use encrypted transport and an HTTP-only secure cookie. Never share the administrator account.
        </p>
      </section>
    </main>
  );
}
