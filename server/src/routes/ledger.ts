// Pick ledger — the PropsBot-style track record: save SGP legs / picks, mark
// results, and compute ROI + win rate from REAL odds only. JSON-file storage
// (zero deps), atomic writes. ROI math: flat 1-unit stakes, decimal odds
// derived from real american odds; won = +decimal-1, lost = -1, push = 0.

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const ledgerRouter = Router();

const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'sports-edge-data') : path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'ledger.json');

export interface LedgerPick {
  id: string;
  createdAt: string;
  sport?: string | null;
  game?: string | null;
  selection: string;
  market?: string | null;
  line?: number | null;
  odds?: number | null; // american
  justification?: string | null;
  risk?: string | null;
  correlation?: string | null;
  confidence?: number | null;
  status: 'pending' | 'won' | 'lost' | 'push';
  settledAt?: string | null;
}

interface LedgerFile {
  picks: LedgerPick[];
}

function load(): LedgerFile {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.picks)) return parsed;
  } catch {
    // corrupt/missing — start fresh, never crash
  }
  return { picks: [] };
}

function save(file: LedgerFile): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
  fs.renameSync(tmp, FILE); // atomic-ish on same volume
}

function americanToDecimal(odds: number | null | undefined): number | null {
  if (typeof odds !== 'number' || !isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
}

function decimalToAmerican(d: number): string {
  if (d >= 2) return `+${Math.round((d - 1) * 100)}`;
  return `${Math.round(-100 / (d - 1))}`;
}

export function computeSummary(picks: LedgerPick[]) {
  const settled = picks.filter((p) => p.status !== 'pending');
  const won = settled.filter((p) => p.status === 'won').length;
  const lost = settled.filter((p) => p.status === 'lost').length;
  const push = settled.filter((p) => p.status === 'push').length;
  let net = 0;
  let priced = 0;
  for (const p of settled) {
    const dec = americanToDecimal(p.odds);
    if (dec === null) continue; // unpriced legs contribute 0 but don't count as priced
    priced++;
    if (p.status === 'won') net += dec - 1;
    else if (p.status === 'lost') net -= 1;
    // push = 0
  }
  const roi = priced > 0 ? (net / priced) * 100 : null;
  const winRate = won + lost > 0 ? (won / (won + lost)) * 100 : null;
  return {
    total: picks.length,
    pending: picks.filter((p) => p.status === 'pending').length,
    won,
    lost,
    push,
    priced,
    netUnits: priced > 0 ? Math.round(net * 100) / 100 : null,
    roi: roi !== null ? Math.round(roi * 10) / 10 : null,
    winRate: winRate !== null ? Math.round(winRate * 10) / 10 : null,
    note: 'ROI = flat 1-unit stakes, settled picks with real odds only; win rate excludes pushes',
  };
}

ledgerRouter.get('/ledger', (_req, res) => {
  const file = load();
  res.json({ picks: file.picks, summary: computeSummary(file.picks) });
});

ledgerRouter.post('/ledger', (req, res) => {
  const legs: any[] = Array.isArray(req.body?.legs) ? req.body.legs : [];
  if (!legs.length) {
    res.status(400).json({ ok: false, error: 'body.legs must be a non-empty array' });
    return;
  }
  const file = load();
  const now = new Date().toISOString();
  const added: LedgerPick[] = legs.map((l) => ({
    id: randomUUID(),
    createdAt: now,
    sport: l.sport ?? null,
    game: l.game ?? null,
    selection: String(l.selection ?? '').slice(0, 300) || 'Unnamed pick',
    market: l.market ?? null,
    line: typeof l.line === 'number' ? l.line : null,
    odds: typeof l.odds === 'number' ? l.odds : null,
    justification: l.justification ?? null,
    risk: l.risk ?? null,
    correlation: l.correlation ?? null,
    confidence: typeof l.confidence === 'number' ? l.confidence : null,
    status: 'pending',
    settledAt: null,
  }));
  file.picks.push(...added);
  save(file);
  res.json({ ok: true, added: added.length, picks: added, summary: computeSummary(file.picks) });
});

ledgerRouter.post('/ledger/:id/result', (req, res) => {
  const status = String(req.body?.status ?? '');
  if (!['won', 'lost', 'push'].includes(status)) {
    res.status(400).json({ ok: false, error: 'status must be won, lost or push' });
    return;
  }
  const file = load();
  const pick = file.picks.find((p) => p.id === req.params.id);
  if (!pick) {
    res.status(404).json({ ok: false, error: 'pick not found' });
    return;
  }
  pick.status = status as LedgerPick['status'];
  pick.settledAt = new Date().toISOString();
  save(file);
  res.json({ ok: true, pick, summary: computeSummary(file.picks) });
});

ledgerRouter.delete('/ledger/:id', (req, res) => {
  const file = load();
  const before = file.picks.length;
  file.picks = file.picks.filter((p) => p.id !== req.params.id);
  if (file.picks.length === before) {
    res.status(404).json({ ok: false, error: 'pick not found' });
    return;
  }
  save(file);
  res.json({ ok: true, removed: 1, summary: computeSummary(file.picks) });
});

// keep decimalToAmerican referenced for future combined-price display
export { decimalToAmerican };
