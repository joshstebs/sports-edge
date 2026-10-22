import type { PlayerResearchObservation, TopEdgePick } from './api';
import { americanToDecimal, americanToImplied } from './odds';
import type { SgpLeg } from '../types';

export function priceScenario(confidence: number, odds: number) {
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 100 || !Number.isFinite(odds) || Math.abs(odds) < 100) return null;
  const probability = confidence / 100;
  return { breakEven: americanToImplied(odds) * 100, edge: confidence - americanToImplied(odds) * 100, ev: (probability * americanToDecimal(odds) - 1) * 100 };
}

export function researchSummary(observations: PlayerResearchObservation[], line: number, side: 'over' | 'under', limit: number) {
  const games = observations.filter((g) => Number.isFinite(g.value)).slice(0, limit);
  const pushes = games.filter((g) => g.value === line).length;
  const hits = games.filter((g) => side === 'over' ? g.value > line : g.value < line).length;
  const decisions = games.length - pushes;
  return { games, hits, pushes, rate: decisions ? hits / decisions * 100 : null, average: games.length ? games.reduce((sum, g) => sum + g.value, 0) / games.length : null };
}

export function quoteAge(timestamp: string, now = Date.now()) {
  const age = now - Date.parse(timestamp);
  if (!Number.isFinite(age) || age < -60_000) return { label: 'Time unverified', review: true };
  const minutes = Math.max(0, Math.floor(age / 60_000));
  return { label: minutes < 60 ? `${minutes}m since recommendation` : `${Math.floor(minutes / 60)}h since recommendation`, review: minutes >= 15 };
}

export function edgePickToLeg(pick: TopEdgePick): SgpLeg {
  return { sport: pick.sport, game: pick.matchup, eventDate: pick.eventDate ?? undefined, selection: pick.selection, market: pick.market, line: pick.line, odds: pick.odds, confidence: pick.confidence, model_version: pick.model, model_source: pick.source ?? undefined, model_sample_size: pick.modelSampleSize ?? undefined };
}

export function marketFamily(market: string) {
  const m = market.toLowerCase().replace(/[_\s-]/g, '');
  if (m === 'moneyline' || m === 'ml') return 'Moneyline';
  if (m.includes('spread')) return 'Spread';
  if (['total', 'totals', 'gametotal', 'teamtotal', 'overunder'].includes(m)) return 'Total';
  return 'Player Props';
}
