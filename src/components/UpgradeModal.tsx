import { useState, type FormEvent } from 'react';
import { startCheckout, openPortal } from '../lib/billing';

interface UpgradeModalProps {
  onClose: () => void;
  canManage?: boolean;
}

export default function UpgradeModal({ onClose, canManage = false }: UpgradeModalProps) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { url } = await startCheckout(email.trim());
      window.location.assign(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start checkout. Please retry.');
      setSubmitting(false);
    }
  };

  const manage = async () => {
    if (!canManage) return;
    setError(null);
    try {
      const url = await openPortal();
      window.location.assign(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open the billing portal.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <section className="w-full max-w-md overflow-hidden rounded-3xl border border-line/80 bg-panel/95 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-8">
        <div className="mb-6">
          <h2 className="font-display text-2xl font-bold tracking-tight text-head">Unlock SportsEdge</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-frost2">
            Live-data AI analysis for props, parlays and same-game bets.
          </p>
        </div>

        <ul className="mb-6 space-y-2 text-sm text-frost">
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-edge" />
            <span><strong className="text-head">7-day free trial</strong> — no charge until it ends</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-edge" />
            <span><strong className="text-head">$9.99/mo</strong> after the trial, cancel anytime</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-edge" />
            <span>Grounded in live Statcast, game logs, weather and odds — never vibes</span>
          </li>
        </ul>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-frost">Email</span>
            <input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              className="w-full rounded-xl border border-line bg-panel2/80 px-3.5 py-3 text-sm text-head outline-none transition placeholder:text-muted focus:border-edge/60 focus:ring-2 focus:ring-edge/15 disabled:opacity-60"
              placeholder="you@example.com"
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
            disabled={submitting || !email.trim()}
            className="flex w-full items-center justify-center rounded-xl bg-edge px-4 py-3 text-sm font-extrabold text-ink shadow-[0_0_22px_rgba(21,255,194,0.22)] transition hover:bg-edge2 focus:outline-none focus:ring-2 focus:ring-edge/50 focus:ring-offset-2 focus:ring-offset-panel disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Starting checkout…' : 'Start free 7-day trial'}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between gap-3 text-[11px]">
          {canManage ? (
            <button onClick={manage} className="font-bold text-edge transition hover:text-edge2">
              Manage subscription
            </button>
          ) : (
            <span className="text-frost2/75">Secure checkout by Stripe</span>
          )}
          <button onClick={onClose} className="font-bold text-frost2 transition hover:text-head">
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
