import type { ChatMessage, SgpLeg } from '../types';
import { legKey } from './odds';

const MAX_SAVED_LEGS = 200;
export const MAX_LEDGER_TICKET_LEGS = 25;

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Validate and normalize the model-generated payload before it reaches React. */
export function normalizeSgpLeg(value: unknown): SgpLeg | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const selection = optionalText(raw.selection);
  if (!selection) return null;

  const line =
    typeof raw.line === 'string' || typeof raw.line === 'number' || raw.line === null
      ? raw.line
      : undefined;
  const odds = optionalNumber(raw.odds);
  const confidence = optionalNumber(raw.confidence);
  const modelProbability =
    typeof raw.model_probability === 'string' || typeof raw.model_probability === 'number'
      ? raw.model_probability
      : undefined;
  const gameOdds =
    typeof raw.game_odds === 'string' || typeof raw.game_odds === 'number'
      ? String(raw.game_odds).trim() || undefined
      : undefined;

  return {
    sport: optionalText(raw.sport),
    game: optionalText(raw.game),
    eventDate: optionalText(raw.eventDate ?? raw.game_date)?.slice(0, 10),
    eventId: optionalText(raw.eventId ?? raw.event_id ?? raw.gamePk),
    entity_type: optionalText(raw.entity_type),
    player_name: optionalText(raw.player_name),
    player_id: optionalText(raw.player_id),
    team: optionalText(raw.team),
    selection,
    market: optionalText(raw.market),
    side: optionalText(raw.side),
    line,
    odds: odds === undefined ? null : odds,
    justification: optionalText(raw.justification),
    risk: optionalText(raw.risk),
    correlation: optionalText(raw.correlation),
    confidence:
      confidence === undefined ? undefined : Math.max(0, Math.min(100, confidence)),
    game_odds: gameOdds ?? null,
    model_probability: modelProbability,
    model_version: optionalText(raw.model_version),
    model_sample_size: optionalNumber(raw.model_sample_size),
    model_source: optionalText(raw.model_source),
    __gateNote: optionalText(raw.__gateNote),
  };
}

/**
 * Append new recommendations while refreshing an already-present wager in
 * place. Functional state updates can call this repeatedly without losing a
 * prior SSE event or producing duplicate slip rows.
 */
export function mergeSgpLegs(previous: readonly SgpLeg[], incoming: readonly unknown[]): SgpLeg[] {
  const byIdentity = new Map<string, SgpLeg>();

  for (const raw of [...previous, ...incoming]) {
    const leg = normalizeSgpLeg(raw);
    if (!leg) continue;
    const identity = legKey(leg);
    const current = byIdentity.get(identity);
    byIdentity.set(identity, current ? { ...current, ...leg } : leg);
  }

  return Array.from(byIdentity.values()).slice(-MAX_SAVED_LEGS);
}

/** Seed the standalone slip when upgrading a session created by the old UI. */
export function collectMessageLegs(messages: readonly ChatMessage[]): SgpLeg[] {
  let legs: SgpLeg[] = [];
  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.sgp)) {
      legs = mergeSgpLegs(legs, message.sgp);
    }
  }
  return legs;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** One wager may be tracked once per local game day. */
export function ledgerLegKey(leg: SgpLeg, date = new Date()): string {
  const officialDate = /^\d{4}-\d{2}-\d{2}$/.test(leg.eventDate ?? '')
    ? leg.eventDate
    : localDateKey(date);
  return `${officialDate}::${legKey(leg)}`;
}

/** Deterministic FNV-1a ticket key: stable across retries, compact in storage. */
export function ledgerTicketKey(legs: readonly SgpLeg[], date = new Date()): string {
  const identity = legs
    .map((leg) => ledgerLegKey(leg, date))
    .sort()
    .join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < identity.length; i += 1) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const officialDates = legs
    .map((leg) => leg.eventDate)
    .filter((value): value is string => /^\d{4}-\d{2}-\d{2}$/.test(value ?? ''))
    .sort();
  return `sports-edge-${officialDates[0] ?? localDateKey(date)}-${(hash >>> 0).toString(36)}`;
}

/** Split a large slip into API-sized, independently retryable tickets. */
export function ledgerTicketBatches<T>(legs: readonly T[], size = MAX_LEDGER_TICKET_LEGS): T[][] {
  const batchSize = Math.max(1, Math.floor(size));
  const batches: T[][] = [];
  for (let index = 0; index < legs.length; index += batchSize) {
    batches.push(legs.slice(index, index + batchSize));
  }
  return batches;
}

/**
 * Rebuild the same dated identities from durable ledger rows. Legacy rows use
 * `createdAt`; v0.2+ rows retain the official event date and event ID.
 */
export function ledgerKeysFromPicks(
  picks: readonly {
    createdAt?: string;
    eventDate?: string | null;
    eventId?: string | null;
    sport?: string | null;
    game?: string | null;
    selection?: string | null;
    market?: string | null;
    line?: string | number | null;
  }[],
): Set<string> {
  const keys = new Set<string>();
  for (const pick of picks) {
    if (!pick.selection) continue;
    const createdAt = pick.createdAt ? new Date(pick.createdAt) : null;
    const officialDate = /^\d{4}-\d{2}-\d{2}$/.test(pick.eventDate ?? '')
      ? pick.eventDate!
      : null;
    if ((!createdAt || !Number.isFinite(createdAt.getTime())) && !officialDate) continue;
    const identityDate = createdAt && Number.isFinite(createdAt.getTime())
      ? createdAt
      : new Date(`${officialDate}T12:00:00.000Z`);
    keys.add(ledgerLegKey({
      sport: pick.sport ?? undefined,
      game: pick.game ?? undefined,
      eventDate: pick.eventDate ?? undefined,
      eventId: pick.eventId ?? undefined,
      selection: pick.selection,
      market: pick.market ?? undefined,
      line: pick.line,
    }, identityDate));
  }
  return keys;
}
