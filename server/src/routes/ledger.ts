// Pick ledger with idempotent ticket saves and optional durable Upstash storage.

import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { redisCommand, redisConfigured, StorageNotConfiguredError } from '../lib/predictionStore.js';

export const ledgerRouter = Router();

const DATA_DIR = process.env.SPORTS_EDGE_DATA_DIR
  ? path.resolve(process.env.SPORTS_EDGE_DATA_DIR)
  : path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'ledger.json');
const LEDGER_KEY = `${process.env.SPORTS_EDGE_REDIS_PREFIX || 'sports-edge'}:ledger`;

export interface LedgerPick {
  id: string;
  userId?: string;
  idempotencyKey?: string | null;
  createdAt: string;
  eventDate?: string | null;
  eventId?: string | null;
  sport?: string | null;
  game?: string | null;
  selection: string;
  matchGameKey?: string | null;
  matchSelectionKey?: string;
  market?: string | null;
  line?: number | null;
  odds?: number | null;
  justification?: string | null;
  risk?: string | null;
  correlation?: string | null;
  confidence?: number | null;
  status: 'pending' | 'won' | 'lost' | 'push';
  settledAt?: string | null;
  settlementSource?: 'manual' | 'prediction-evaluator' | null;
}

interface LedgerFile { picks: LedgerPick[] }
let localMutationTail = Promise.resolve();

function withLocalMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = localMutationTail.then(operation, operation);
  localMutationTail = run.then(() => undefined, () => undefined);
  return run;
}

function emptyLedger(): LedgerFile { return { picks: [] }; }

async function load(): Promise<LedgerFile> {
  if (redisConfigured()) {
    const raw = await redisCommand<string | null>(['GET', LEDGER_KEY]);
    if (!raw) return emptyLedger();
    const value = JSON.parse(raw);
    if (!value || !Array.isArray(value.picks)) throw new Error('Stored ledger is corrupt');
    return value;
  }
  if (process.env.VERCEL) throw new StorageNotConfiguredError();
  try {
    const value = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return value && Array.isArray(value.picks) ? value : emptyLedger();
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return emptyLedger();
    throw error;
  }
}

async function save(file: LedgerFile): Promise<void> {
  if (redisConfigured()) {
    await redisCommand(['SET', LEDGER_KEY, JSON.stringify(file)]);
    return;
  }
  if (process.env.VERCEL) throw new StorageNotConfiguredError();
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await fs.rename(tmp, FILE);
}

const ADD_TICKET_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local doc = raw and cjson.decode(raw) or {picks={}}
local userId = ARGV[1]
local idem = ARGV[2]
if idem ~= '' then
  local existing = {}
  for _, p in ipairs(doc.picks or {}) do
    local owner = p.userId or 'admin'
    if owner == userId and p.idempotencyKey == idem then table.insert(existing, p) end
  end
  if #existing > 0 then
    local copy = cjson.decode(cjson.encode(doc))
    return cjson.encode({duplicate=true, picks=existing, doc=copy})
  end
end
local incoming = cjson.decode(ARGV[3])
for _, p in ipairs(incoming) do table.insert(doc.picks, p) end
redis.call('SET', KEYS[1], cjson.encode(doc))
local copy = cjson.decode(cjson.encode(doc))
return cjson.encode({duplicate=false, picks=incoming, doc=copy})`;

async function addTicketAtomic(added: LedgerPick[], userId: string, idempotencyKey: string | null): Promise<{ duplicate: boolean; picks: LedgerPick[]; doc: LedgerFile }> {
  if (redisConfigured()) {
    const raw = await redisCommand<string>(['EVAL', ADD_TICKET_SCRIPT, 1, LEDGER_KEY, userId, idempotencyKey ?? '', JSON.stringify(added)]);
    return JSON.parse(raw);
  }
  return withLocalMutation(async () => {
    const doc = await load();
    if (idempotencyKey) {
      const existing = doc.picks.filter((pick) => ownedBy(pick, userId) && pick.idempotencyKey === idempotencyKey);
      if (existing.length) return { duplicate: true, picks: existing, doc };
    }
    doc.picks.push(...added);
    await save(doc);
    return { duplicate: false, picks: added, doc };
  });
}

const SET_RESULT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local doc = raw and cjson.decode(raw) or {picks={}}
for _, p in ipairs(doc.picks or {}) do
  local owner = p.userId or 'admin'
  if p.id == ARGV[1] and owner == ARGV[2] then
    p.status = ARGV[3]
    p.settledAt = ARGV[4]
    p.settlementSource = 'manual'
    redis.call('SET', KEYS[1], cjson.encode(doc))
    local copy = cjson.decode(cjson.encode(doc))
    return cjson.encode({found=true, pick=p, doc=copy})
  end
end
return cjson.encode({found=false})`;

async function setResultAtomic(
  id: string, userId: string, status: LedgerPick['status'], settledAt: string,
): Promise<{ file: LedgerFile; pick: LedgerPick } | null> {
  if (redisConfigured()) {
    const raw = await redisCommand<string>([
      'EVAL', SET_RESULT_SCRIPT, 1, LEDGER_KEY, id, userId, status, settledAt,
    ]);
    const result = JSON.parse(raw);
    return result.found ? { file: result.doc, pick: result.pick } : null;
  }
  return withLocalMutation(async () => {
    const file = await load();
    const pick = file.picks.find((candidate) => candidate.id === id && ownedBy(candidate, userId));
    if (!pick) return null;
    pick.status = status;
    pick.settledAt = settledAt;
    pick.settlementSource = 'manual';
    await save(file);
    return { file, pick };
  });
}

const DELETE_PICK_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local doc = raw and cjson.decode(raw) or {picks={}}
local kept = {}
local found = false
for _, p in ipairs(doc.picks or {}) do
  local owner = p.userId or 'admin'
  if p.id == ARGV[1] and owner == ARGV[2] then
    found = true
  else
    table.insert(kept, p)
  end
end
if not found then return cjson.encode({found=false}) end
doc.picks = kept
redis.call('SET', KEYS[1], cjson.encode(doc))
return cjson.encode({found=true, doc=doc})`;

async function deletePickAtomic(id: string, userId: string): Promise<LedgerFile | null> {
  if (redisConfigured()) {
    const raw = await redisCommand<string>([
      'EVAL', DELETE_PICK_SCRIPT, 1, LEDGER_KEY, id, userId,
    ]);
    const result = JSON.parse(raw);
    return result.found ? result.doc : null;
  }
  return withLocalMutation(async () => {
    const file = await load();
    const before = file.picks.length;
    file.picks = file.picks.filter((pick) => pick.id !== id || !ownedBy(pick, userId));
    if (file.picks.length === before) return null;
    await save(file);
    return file;
  });
}

function americanToDecimal(odds: number | null | undefined): number | null {
  if (typeof odds !== 'number' || !Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
}

function decimalToAmerican(decimal: number): string {
  if (decimal >= 2) return `+${Math.round((decimal - 1) * 100)}`;
  return `${Math.round(-100 / (decimal - 1))}`;
}

export function computeSummary(picks: LedgerPick[]) {
  const settled = picks.filter((pick) => pick.status !== 'pending');
  const won = settled.filter((pick) => pick.status === 'won').length;
  const lost = settled.filter((pick) => pick.status === 'lost').length;
  const push = settled.filter((pick) => pick.status === 'push').length;
  let net = 0;
  let priced = 0;
  for (const pick of settled) {
    const decimal = americanToDecimal(pick.odds);
    if (decimal === null) continue;
    priced++;
    if (pick.status === 'won') net += decimal - 1;
    else if (pick.status === 'lost') net -= 1;
  }
  const roi = priced ? (net / priced) * 100 : null;
  const winRate = won + lost ? (won / (won + lost)) * 100 : null;
  return {
    total: picks.length, pending: picks.filter((pick) => pick.status === 'pending').length,
    won, lost, push, priced,
    netUnits: priced ? Math.round(net * 100) / 100 : null,
    roi: roi == null ? null : Math.round(roi * 10) / 10,
    winRate: winRate == null ? null : Math.round(winRate * 10) / 10,
    note: 'ROI = flat 1-unit stakes, settled picks with real odds only; win rate excludes pushes',
  };
}

function apiError(res: any, error: unknown): void {
  const unavailable = error instanceof StorageNotConfiguredError;
  res.status(unavailable ? 503 : 500).json({
    ok: false, code: unavailable ? error.code : 'LEDGER_STORAGE_ERROR', error: (error as Error).message,
  });
}

function requestUserId(req: { auth?: { userId: string } }): string {
  if (!req.auth) throw new Error('Authenticated user context is required');
  return req.auth.userId;
}
function ownedBy(pick: LedgerPick, userId: string): boolean { return (pick.userId ?? 'admin') === userId; }
function optionalNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

ledgerRouter.get('/ledger', async (_req, res) => {
  const userId = requestUserId(_req);
  try {
    const file = await load(); const picks = file.picks.filter((pick) => ownedBy(pick, userId));
    res.json({ picks, summary: computeSummary(picks) });
  }
  catch (error) { apiError(res, error); }
});

ledgerRouter.post('/ledger', async (req, res) => {
  const legs: any[] = Array.isArray(req.body?.legs) ? req.body.legs : [];
  if (!legs.length) { res.status(400).json({ ok: false, error: 'body.legs must be a non-empty array' }); return; }
  if (legs.length > 25) { res.status(400).json({ ok: false, error: 'a ticket may contain at most 25 legs' }); return; }
  if (legs.some((leg) => !leg || typeof leg.selection !== 'string' || !leg.selection.trim())) {
    res.status(400).json({ ok: false, error: 'every leg requires a non-empty selection' });
    return;
  }
  const idempotencyKey = typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()
    ? req.body.idempotencyKey.trim().slice(0, 200) : null;
  const userId = requestUserId(req);
  try {
    const now = new Date().toISOString();
    const added: LedgerPick[] = legs.map((leg) => ({
      id: randomUUID(), userId, idempotencyKey, createdAt: now,
      sport: leg.sport ?? null, game: leg.game ?? null,
      eventDate: typeof leg.eventDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(leg.eventDate)
        ? leg.eventDate : null,
      eventId: typeof leg.eventId === 'string' && leg.eventId.trim()
        ? leg.eventId.trim().slice(0, 100) : null,
      selection: leg.selection.trim().slice(0, 300),
      matchGameKey: leg.game ? norm(String(leg.game)) : null,
      matchSelectionKey: norm(String(leg.selection ?? '').slice(0, 300) || 'Unnamed pick'),
      market: leg.market ?? null,
      line: optionalNumber(leg.line),
      odds: optionalNumber(leg.odds) !== 0 ? optionalNumber(leg.odds) : null,
      justification: leg.justification ?? null, risk: leg.risk ?? null,
      correlation: leg.correlation ?? null,
      confidence: optionalNumber(leg.confidence) == null
        ? null : Math.max(0, Math.min(100, optionalNumber(leg.confidence)!)),
      status: 'pending', settledAt: null, settlementSource: null,
    }));
    const result = await addTicketAtomic(added, userId, idempotencyKey);
    const owned = result.doc.picks.filter((pick) => ownedBy(pick, userId));
    res.json({ ok: true, added: result.duplicate ? 0 : result.picks.length, duplicate: result.duplicate, idempotencyKey, picks: result.picks, summary: computeSummary(owned) });
  } catch (error) { apiError(res, error); }
});

ledgerRouter.post('/ledger/:id/result', async (req, res) => {
  const status = String(req.body?.status ?? '');
  if (!['won', 'lost', 'push'].includes(status)) { res.status(400).json({ ok: false, error: 'status must be won, lost or push' }); return; }
  try {
    const userId = requestUserId(req);
    const result = await setResultAtomic(
      req.params.id, userId, status as LedgerPick['status'], new Date().toISOString(),
    );
    if (!result) { res.status(404).json({ ok: false, error: 'pick not found' }); return; }
    const { file, pick } = result;
    res.json({ ok: true, pick, summary: computeSummary(file.picks.filter((candidate) => ownedBy(candidate, userId))) });
  } catch (error) { apiError(res, error); }
});

ledgerRouter.delete('/ledger/:id', async (req, res) => {
  try {
    const userId = requestUserId(req);
    const file = await deletePickAtomic(req.params.id, userId);
    if (!file) { res.status(404).json({ ok: false, error: 'pick not found' }); return; }
    res.json({ ok: true, removed: 1, summary: computeSummary(file.picks.filter((pick) => ownedBy(pick, userId))) });
  } catch (error) { apiError(res, error); }
});

function norm(value: string): string {
  return value.toLowerCase().replace(/\b(over|under)\b/g, (side) => side[0]).replace(/[^a-z0-9.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const SETTLE_MATCHES_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local doc = cjson.decode(raw)
local changed = 0
for _, p in ipairs(doc.picks or {}) do
  local owner = p.userId or 'admin'
  local legacyGame = string.lower(p.game or '') == string.lower(ARGV[6])
  local sameGame = (not p.game) or ARGV[1] == '' or p.matchGameKey == ARGV[1] or legacyGame
  local sameSelection = p.matchSelectionKey == ARGV[2] or string.lower(p.selection or '') == string.lower(ARGV[7])
  if owner == ARGV[5] and p.status == 'pending' and sameGame and sameSelection then
    p.status = ARGV[3]
    p.settledAt = ARGV[4]
    p.settlementSource = 'prediction-evaluator'
    changed = changed + 1
  end
end
if changed > 0 then redis.call('SET', KEYS[1], cjson.encode(doc)) end
return changed`;

/** Idempotently propagate official evaluation results into matching saved slip legs. */
export async function settleLedgerMatches(
  game: string, selection: string, outcome: 'won' | 'lost' | 'push', settledAt: string, userId = 'admin',
): Promise<number> {
  const gameKey = norm(game);
  const selectionKey = norm(selection);
  if (redisConfigured()) {
    return redisCommand<number>(['EVAL', SETTLE_MATCHES_SCRIPT, 1, LEDGER_KEY, gameKey, selectionKey, outcome, settledAt, userId, game, selection]);
  }
  return withLocalMutation(async () => {
    const file = await load();
    let changed = 0;
    for (const pick of file.picks) {
      if (pick.status !== 'pending' || !ownedBy(pick, userId)) continue;
      const sameGame = !pick.game || !gameKey || norm(pick.game) === gameKey;
      if (sameGame && norm(pick.selection) === selectionKey) {
        pick.status = outcome;
        pick.settledAt = settledAt;
        pick.settlementSource = 'prediction-evaluator';
        changed++;
      }
    }
    if (changed) await save(file);
    return changed;
  });
}

export { decimalToAmerican };
