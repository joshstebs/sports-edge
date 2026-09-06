function marketLabel(value: unknown): string {
  return String(value ?? 'prop').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function candidateLine(candidate: any): number | null {
  const live = Number(candidate?.marketLine);
  if (candidate?.marketLine != null && Number.isFinite(live)) return live;
  const model = Number(candidate?.suggestedLine);
  return candidate?.suggestedLine != null && Number.isFinite(model) ? model : null;
}

function candidateOdds(candidate: any): number | null {
  const raw = String(candidate?.side ?? '').toLowerCase() === 'under' ? candidate?.marketOddsUnder : candidate?.marketOddsOver;
  const value = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(value) && value !== 0 ? value : null;
}

function lineLabel(candidate: any): string {
  if (candidate?.marketLine == null) return 'MODEL SCREENING LINE';
  if (candidate?.isAlternate || candidate?.lineType === 'alternate') return 'ALTERNATE LINE';
  return candidate?.lineLabel ?? 'PRIMARY / CONSENSUS LINE';
}

/**
 * Render screener rows into prose plus the same structured blocks consumed by
 * the chat route. This closes a historical gap where fast-screened picks were
 * visible to the user but never entered PREDICTION_LOG, so they could not be
 * graded the next morning.
 */
export function renderScreenerSummaryBlocks(candidates: any[], requested: number): string {
  const top = candidates.slice(0, Math.max(1, requested));
  const output: string[] = [];
  const timestamp = new Date().toISOString();
  const anyProvisional = top.some((candidate) => String(candidate?.sport ?? '').toLowerCase() === 'mlb' && candidate?.inLineupToday === false);

  output.push('**Verified slate screen — ' + top.length + ' qualified candidate' + (top.length === 1 ? '' : 's') + ' (model grades, live stats).**');
  if (anyProvisional) {
    output.push('');
    output.push('⚠️ **Some MLB batting orders are not posted yet.** Picks marked 🕐 are provisional and are not saved to the learning ledger until final game-day verification.');
  }
  output.push('');

  const sgpLegs: any[] = [];
  const logs: any[] = [];
  top.forEach((candidate, index) => {
    const line = candidateLine(candidate);
    const odds = candidateOdds(candidate);
    const confidencePct = Number(candidate?.confidencePct);
    const confidence = Number.isFinite(confidencePct) ? Math.round(confidencePct) : undefined;
    const label = lineLabel(candidate);
    const sport = String(candidate?.sport ?? '').toUpperCase();
    const provisional = sport === 'MLB' && candidate?.inLineupToday === false;
    const qualityTier = confidencePct >= 58 ? 'core' : 'supplemental';
    const selection = String(candidate?.player ?? '') + ' ' + String(candidate?.side ?? 'over').toUpperCase() + ' ' + (line ?? '?') + ' ' + marketLabel(candidate?.market);
    const matchup = String(candidate?.team ?? '') + ' vs ' + String(candidate?.opponent ?? '');
    const flag = provisional ? ' 🕐' : '';
    const prob = Number.isFinite(confidencePct) ? confidencePct + '%' : 'n/a';

    output.push((index + 1) + '. **' + candidate.player + '** (' + matchup + ')' + flag + ' — ' + marketLabel(candidate.market) + ' ' + String(candidate.side ?? '').toUpperCase() + ' ' + (line ?? '?') + ' · model ' + prob + ' (Grade ' + String(candidate.grade ?? '?') + ')');
    let marketNote = '   _' + label;
    if (candidate?.marketBook) marketNote += ' · ' + candidate.marketBook;
    if (candidate?.bookCount) marketNote += ' · ' + candidate.bookCount + ' book' + (candidate.bookCount === 1 ? '' : 's');
    if (odds != null) marketNote += ' · ' + (odds > 0 ? '+' : '') + odds;
    marketNote += '_';
    output.push(marketNote);
    if (Array.isArray(candidate?.alternateLines) && candidate.alternateLines.length) {
      output.push('   _Alternate lines available but deprioritized: ' + candidate.alternateLines.slice(0, 3).map((row: any) => row.line).join(', ') + '._');
    }
    const hitRate = candidate?.recentHitRate;
    if (hitRate) {
      const parts: string[] = [];
      if (hitRate.last5 != null) parts.push('L5 ' + Math.round(Number(hitRate.last5) * 100) + '%');
      if (hitRate.last20 != null) parts.push('L20 ' + Math.round(Number(hitRate.last20) * 100) + '%');
      if (parts.length) output.push('   _form: ' + parts.join(' · ') + '_');
    }

    sgpLegs.push({
      entity_type: 'player', player_name: candidate.player, sport, game: matchup,
      game_date: candidate.eventDate, event_id: candidate.eventId, selection,
      market: candidate.market, side: candidate.side, line, odds, game_odds: null,
      justification: label + '; deterministic ' + String(candidate.modelVersion ?? 'model') + ' ' + prob,
      risk: qualityTier === 'core' ? 'Medium' : 'Medium-High', correlation: 'Neutral',
      confidence, provisional, quality_tier: qualityTier, line_type: label,
    });

    // Never log MLB pre-lineup candidates. The SGP may show them provisionally,
    // but only final-eligible rows are allowed into the learning ledger.
    if (!provisional && line != null) {
      logs.push({
        prediction_id: 'screen-' + String(candidate.eventDate ?? timestamp.slice(0, 10)) + '-' + String(candidate.eventId ?? index),
        timestamp, game_date: candidate.eventDate, event_id: candidate.eventId, sport, matchup, bet_type: 'PROP',
        legs: [{
          entity_type: 'player', player_name: candidate.player, leg_name: selection, player_id: candidate.playerId ?? null,
          market: candidate.market, side: candidate.side, line, target_line: String(line),
          model_probability: candidate.confidencePct, model_version: candidate.modelVersion ?? null,
          model_sample_size: candidate.sampleSize ?? null, model_source: candidate.source ?? null,
          implied_odds: odds, key_metric_used: label,
        }],
        recommended_units: qualityTier === 'core' ? '0.5' : '0.25',
      });
    }
  });

  if (top.length < requested) {
    output.push('');
    output.push('⚠️ **Shortfall:** only ' + top.length + ' of ' + requested + ' requested legs cleared the modeled quality floor after a broader slate scan.');
  }
  output.push('');
  output.push('_Primary/consensus sportsbook lines are preferred. Alternate lines are labeled and ranked behind the primary market. A model screening line is shown only when no real primary line is available._');
  if (sgpLegs.length) {
    output.push(''); output.push('```sgp'); output.push(JSON.stringify({ legs: sgpLegs })); output.push('```');
  }
  for (const log of logs) {
    output.push(''); output.push('[PREDICTION_LOG]'); output.push(JSON.stringify(log));
  }
  return output.join('\n');
}
