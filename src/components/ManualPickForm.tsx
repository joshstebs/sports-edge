import { useRef, useState, type FormEvent } from 'react';
import { saveLedgerTicket, type LedgerPick } from '../lib/api';

const input = 'mt-1 min-h-10 w-full rounded-lg border border-line bg-ink px-3 text-sm text-head';

export default function ManualPickForm({ onSave }: { onSave: (pick: LedgerPick) => void }) {
  const request = useRef<{ payload: string; key: string }>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const selection = String(fields.get('selection') ?? '').trim();
    const price = String(fields.get('odds') ?? '').trim();
    const odds = Number(price);
    if (!selection || !/^[+-]?\d+$/.test(price) || !Number.isSafeInteger(odds) || Math.abs(odds) < 100) {
      setMessage({ text: 'Enter a selection and American odds such as -110 or +150.', error: true });
      return;
    }

    const leg = {
      entrySource: 'manual',
      selection,
      odds,
      sport: fields.get('sport') || null,
      game: String(fields.get('game') ?? '').trim() || null,
      eventDate: fields.get('eventDate') || null,
    };
    const payload = JSON.stringify(leg);
    if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
    busy.current = true;
    setSaving(true);
    setMessage(undefined);
    try {
      const { picks } = await saveLedgerTicket([leg], request.current.key);
      if (!picks?.[0]) throw new Error('The server did not return the saved pick. Try again.');
      onSave(picks[0]);
      request.current = null;
      form.reset();
      setMessage({ text: 'Pick saved as pending.' });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Could not save pick.', error: true });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="mb-4 rounded-xl border border-line bg-panel p-4" onSubmit={submit}>
      <h3 className="mb-3 text-sm font-semibold text-head">Log a pick</h3>
      <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-frost">Selection
          <input className={input} name="selection" placeholder="Boston -2.5" maxLength={300} required />
        </label>
        <label className="text-sm text-frost">American odds
          <input className={input} name="odds" placeholder="-110" maxLength={12} required />
        </label>
        <label className="text-sm text-frost">Matchup
          <input className={input} name="game" placeholder="Toronto at Boston" maxLength={150} />
        </label>
        <label className="text-sm text-frost">Sport
          <select className={input} name="sport" defaultValue="">
            <option value="">Optional</option>
            <option>MLB</option><option>NFL</option><option>NBA</option><option>NHL</option><option>Other</option>
          </select>
        </label>
        <label className="text-sm text-frost">Game date
          <input className={input} name="eventDate" type="date" />
        </label>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className="min-h-10 rounded-lg bg-edge px-3 text-sm font-semibold text-ink disabled:opacity-60">
          {saving ? 'Saving…' : 'Save pick'}
        </button>
        {message && <p role={message.error ? 'alert' : 'status'} className={`text-sm ${message.error ? 'text-danger' : 'text-frost'}`}>{message.text}</p>}
      </div>
    </form>
  );
}
