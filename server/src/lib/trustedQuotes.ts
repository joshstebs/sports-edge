import { hasCurrentMarketLine } from './parlayQuality.js';
import { normalizeMarket } from '../models/playerPropModel.js';
import { normalizeName } from '../providers/http.js';
import { playerFromSelection } from '../providers/playerAvailability.js';
import { marketLabel } from '../llm/screenerRenderer.js';

/** Match generated structured legs against quotes returned by server-side tools. */
export function applyTrustedQuote<T extends Record<string, any>>(leg: T, candidates: any[], nowMs = Date.now()): T {
  const eventId = String(leg.event_id ?? leg.eventId ?? leg.game_id ?? leg.gamePk ?? '').trim();
  const eventDate = String(leg.game_date ?? leg.gameDate ?? leg.eventDate ?? '').slice(0, 10);
  const sport = String(leg.sport ?? '').trim().toLowerCase();
  const entity = String(leg.entity_type ?? '').trim().toLowerCase();
  const game = entity === 'team' || entity === 'game';
  const selection = String(leg.selection ?? leg.leg_name ?? '').trim();
  const player = String(leg.player_name ?? '').trim() || playerFromSelection(selection) || '';
  const selectedPlayer = playerFromSelection(selection);
  const odds = leg.odds ?? leg.implied_odds;
  const line = leg.line ?? leg.target_line;
  const side = String(leg.side ?? '').toLowerCase();
  const found = eventId && /^\d{4}-\d{2}-\d{2}$/.test(eventDate) && candidates.find((candidate) => {
    const candidateGame = candidate?.candidateType === 'game_market';
    if (candidateGame !== game || String(candidate?.eventId ?? '').trim() !== eventId ||
        String(candidate?.eventDate ?? '').slice(0, 10) !== eventDate ||
        String(candidate?.sport ?? '').toLowerCase() !== sport) return false;
    const quoteOdds = game ? candidate?.marketOdds : (candidate?.marketOdds ?? (side === 'under' ? candidate?.marketOddsUnder : candidate?.marketOddsOver));
    if (odds == null || String(odds).trim() === '' || quoteOdds == null || Number(odds) !== Number(quoteOdds)) return false;
    if (game) {
      const expectedSelection = String(candidate?.selection ?? `${candidate?.team ?? ''} ML`).trim();
      if (!leg.team || normalizeName(String(leg.team)) !== normalizeName(String(candidate?.team ?? '')) ||
          normalizeName(selection) !== normalizeName(expectedSelection)) return false;
    } else {
      const expectedSelection = `${candidate?.player ?? ''} ${String(candidate?.side ?? '').toUpperCase()} ${candidate?.marketLine ?? '?'} ${marketLabel(candidate?.market)}`;
      if (!player || !candidate?.player || normalizeName(player) !== normalizeName(String(candidate.player)) ||
          !selectedPlayer || normalizeName(selectedPlayer) !== normalizeName(player) ||
          normalizeName(selection) !== normalizeName(expectedSelection) ||
          normalizeMarket(String(leg.market ?? '')) !== normalizeMarket(String(candidate.market ?? '')) ||
          side !== String(candidate.side ?? '').toLowerCase() || line == null || candidate.marketLine == null ||
          Number(line) !== Number(candidate.marketLine)) return false;
    }
    return hasCurrentMarketLine({ entity_type: game ? 'team' : 'player', sport, market: candidate.market,
      side, line: candidate.marketLine, odds: quoteOdds,
      line_source: candidate.marketSource, line_checked_at: candidate.marketCheckedAt }, nowMs);
  });
  if (!found) return { ...leg, line_verified: false, line_source: null, line_checked_at: null };
  return { ...leg, line_verified: true, line_source: found.marketSource, line_checked_at: found.marketCheckedAt };
}
