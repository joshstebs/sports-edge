import { buildPlayerPropModel, type HistoricalObservation, type ModelSport, type PlayerPropModelResult, type ModelSide } from './playerPropModel.js';

export interface PropLineEvaluationInput {
  sport: ModelSport;
  market: string;
  line: number;
  observations: HistoricalObservation[];
  source: string;
  calibration?: { n: number; averageConfidence: number | null; hitRate: number } | null;
  oddsOver?: number | null;
  oddsUnder?: number | null;
  requestedSide?: ModelSide | null;
}

export interface PropLineEvaluation {
  chosen: PlayerPropModelResult | null;
  over: PlayerPropModelResult | null;
  under: PlayerPropModelResult | null;
  edgeOver: number | null;
  edgeUnder: number | null;
}

function usable(model: PlayerPropModelResult | null): model is PlayerPropModelResult {
  return Boolean(model?.available && model.probability != null);
}

/**
 * Re-score both sides at the exact displayed sportsbook line. When no side
 * was requested, positive expected-value edges take priority over raw hit
 * probability; if neither side has positive edge, the model probability is
 * used as a fallback. This prevents a stale model-side choice at a nearby
 * screening line from becoming an under recommendation at a different book line.
 */
export function evaluatePropLine(input: PropLineEvaluationInput): PropLineEvaluation {
  const over = buildPlayerPropModel({
    sport: input.sport, market: input.market, side: 'over', line: input.line,
    observations: input.observations, source: input.source, calibration: input.calibration,
    americanOdds: input.oddsOver ?? null,
  });
  const under = buildPlayerPropModel({
    sport: input.sport, market: input.market, side: 'under', line: input.line,
    observations: input.observations, source: input.source, calibration: input.calibration,
    americanOdds: input.oddsUnder ?? null,
  });
  const options = [over, under].filter(usable);
  if (!options.length) return { chosen: null, over: null, under: null, edgeOver: null, edgeUnder: null };
  let chosen: PlayerPropModelResult | null = null;
  if (input.requestedSide) {
    chosen = input.requestedSide === 'over' ? (usable(over) ? over : null) : (usable(under) ? under : null);
  } else {
    const positiveValue = options.filter((row) => row.estimatedEdge != null && row.estimatedEdge > 0);
    const ranked = [...(positiveValue.length ? positiveValue : options)].sort((a, b) =>
      (b.estimatedEdge ?? -Infinity) - (a.estimatedEdge ?? -Infinity)
      || (b.probability ?? 0) - (a.probability ?? 0)
    );
    chosen = ranked[0] ?? null;
  }
  return {
    chosen,
    over: usable(over) ? over : null,
    under: usable(under) ? under : null,
    edgeOver: usable(over) && over.estimatedEdge != null ? over.estimatedEdge : null,
    edgeUnder: usable(under) && under.estimatedEdge != null ? under.estimatedEdge : null,
  };
}
