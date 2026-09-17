function marketLabel(value: unknown): string {
  const key = String(value ?? '').trim();
  const labels: Record<string, string> = {
    hits: 'Hits', totalBases: 'Total Bases', homeRuns: 'Home Runs', rbi: 'RBIs', runs: 'Runs',
    strikeouts: 'Strikeouts', outsRecorded: 'Outs Recorded', passingYards: 'Passing Yards',
    passingTouchdowns: 'Passing Touchdowns', rushingYards: 'Rushing Yards', receivingYards: 'Receiving Yards',
    receptions: 'Receptions', rushingReceivingYards: 'Rushing + Receiving Yards', touchdowns: 'Touchdowns',
    points: 'Points', rebounds: 'Rebounds', assists: 'Assists', threePointersMade: '3-Pointers',
    shotsOnGoal: 'Shots on Goal', hockeyPoints: 'Hockey Points', saves: 'Saves', goals: 'Goals',
  };
  if (labels[key]) return labels[key];
  const pretty = key || 'prop';
  return pretty.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^[a-z]/, (c) => c.toUpperCase());
}

function candidateLine(candidate: any): number | null {
  const live = Number(candidate?.marketLine);
  if (candidate?.marketLine != null && Number.isFinite(live)) return live;
  const model = Number(candidate?.suggestedLine);
  return candidate?.suggestedLine != null && Number.isFinite(model) ? model : null;
}

function candidateOdds(candidate: any): number | null {
  const direct = Number(candidate?.marketOdds);
  if (candidate?.marketOdds != null && candidate?.marketOdds !== '' && Number.isFinite(direct) && direct !== 0) return direct;
  const raw = String(candidate?.side ?? '').toLowerCase() === 'under' ? candidate?.marketOddsUnder : candidate?.marketOddsOver;
  const value = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(value) && value !== 0 ? value : null;
}

function isGameMarket(candidate: any): boolean {
  return candidate?.candidateType === 'game_market' || candidate?.entityType === 'team' || String(candidate?.market ?? '').toLowerCase() === 'moneyline';
}

function lineLabel(candidate: any): string {
  if (isGameMarket(candidate)) return candidate?.lineLabel ?? 'LIVE GAME MARKET';
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
  // Keep a wider structured pool so server-side availability, line, and quality\n  // gates can backfill rejected top rows without asking the model to invent more.\n  const poolSize = Math.max(1, requested * 2, requested + 4);\n  const top = candidates.slice(0, poolSize);
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
    const gameMarket = isGameMarket(candidate);
    const line = candidateLine(candidate);
    const odds = candidateOdds(candidate);
    const confidencePct = Number(candidate?.confidencePct);
    const confidence = Number.isFinite(confidencePct) ? Math.round(confidencePct) : undefined;
    const label = lineLabel(candidate);
    const sport = String(candidate?.sport ?? '').toUpperCase();
    const provisional = !gameMarket && sport === 'MLB' && candidate?.inLineupToday === false;
    const qualityTier = confidencePct >= 58 ? 'core' : 'supplemental';
    const matchup = String(candidate?.team ?? '') + ' vs ' + String(candidate?.opponent ?? '');
    const flag = provisional ? ' 🕐' : '';
    const prob = Number.isFinite(confidencePct) ? confidencePct + '%' : 'n/a';
    const selection = gameMarket
      ? String(candidate?.selection ?? (String(candidate?.team ?? '') + ' ML'))
      : String(candidate?.player ?? '') + ' ' + String(candidate?.side ?? 'over').toUpperCase() + ' ' + (line ?? '?') + ' ' + marketLabel(candidate?.market);

    if (gameMarket) {
      output.push((index + 1) + '. **' + candidate.team + '** (' + matchup + ') — Moneyline ' + (odds != null ? ((odds > 0 ? '+' : '') + odds) : 'price unavailable') + ' · no-vig market probability ' + prob + ' (Grade ' + String(candidate.grade ?? '?') + ')');
      if (candidate?.note) output.push('   _' + String(candidate.note) + '_');
    } else {
      output.push((index + 1) + '. **' + candidate.player + '** (' + matchup + ')' + flag + ' — ' + marketLabel(candidate.market) + ' ' + String(candidate.side ?? '').toUpperCase() + ' ' + (line ?? '?') + ' · model ' + prob + ' (Grade ' + String(candidate.grade ?? '?') + ')');
    }

    let marketNote = '   _' + label;
    if (candidate?.marketBook) marketNote += ' · ' + candidate.marketBook;
    if (candidate?.bookCount) marketNote += ' · ' + candidate.bookCount + ' book' + (candidate.bookCount === 1 ? '' : 's');
    if (!gameMarket && odds != null) marketNote += ' · ' + (odds > 0 ? '+' : '') + odds;
    marketNote += '_';
    output.push(marketNote);

    if (!gameMarket && Array.isArray(candidate?.alternateLines) && candidate.alternateLines.length) {
      output.push('   _Alternate lines available but deprioritized: ' + candidate.alternateLines.slice(0, 3).map((row: any) => row.line).join(', ') + '._');
    }
    const hitRate = candidate?.recentHitRate;
    if (!gameMarket && hitRate) {
      const parts: string[] = [];
      if (hitRate.last5 != null) parts.push('L5 ' + Math.round(Number(hitRate.last5) * 100) + '%');
      if (hitRate.last20 != null) parts.push('L20 ' + Math.round(Number(hitRate.last20) * 100) + '%');
      if (parts.length) output.push('   _form: ' + parts.join(' · ') + '_');
    }

    const qualitySource = String(candidate?.qualitySource ?? candidate?.source ?? '').trim() || null;\n    const lineSource = String(candidate?.marketSource ?? candidate?.source ?? '').trim() || null;\n    const lineVerified = Boolean(odds != null && lineSource && (gameMarket || candidate?.marketLine != null));\n    sgpLegs.push({
      entity_type: gameMarket ? 'team' : 'player',
      ...(gameMarket ? { team: candidate.team, quality_source: qualitySource } : { player_name: candidate.player }),
      sport, game: matchup, game_date: candidate.eventDate, event_id: candidate.eventId, selection,
      market: candidate.market, side: gameMarket ? null : candidate.side, line: gameMarket ? null : line,
      odds, game_odds: null, line_verified: lineVerified, line_source: lineSource, line_checked_at: timestamp,\n      justification: gameMarket
        ? label + '; ' + String(candidate.modelVersion ?? 'market-consensus-v1') + ' no-vig probability ' + prob
        : label + '; deterministic ' + String(candidate.modelVersion ?? 'model') + ' ' + prob,
      risk: qualityTier === 'core' ? 'Medium' : 'Medium-High', correlation: 'Neutral',
      confidence, provisional, quality_tier: qualityTier, line_type: label,
    });

    // Never log MLB pre-lineup player candidates. Game markets and all final
    // player props use the exact same visible selection/price in the ledger.
    if (!provisional && (gameMarket || line != null)) {
      logs.push({
        prediction_id: 'screen-' + String(candidate.eventDate ?? timestamp.slice(0, 10)) + '-' + String(candidate.eventId ?? index) + '-' + (gameMarket ? 'ml' : String(candidate.player ?? index).toLowerCase().replace(/[^a-z0-9]+/g, '-')),
        timestamp, game_date: candidate.eventDate, event_id: candidate.eventId, sport, matchup,
        bet_type: gameMarket ? 'MONEYLINE' : 'PROP',
        legs: [{
          entity_type: gameMarket ? 'team' : 'player',
          ...(gameMarket ? { team: candidate.team, quality_source: qualitySource } : { player_name: candidate.player, player_id: candidate.playerId ?? null }),
          leg_name: selection,
          market: candidate.market,
          side: gameMarket ? null : candidate.side,
          line: gameMarket ? null : line,
          target_line: gameMarket ? '' : String(line),
          model_probability: candidate.confidencePct,
          model_version: candidate.modelVersion ?? null,
          model_sample_size: gameMarket ? null : (candidate.sampleSize ?? null),
          model_source: qualitySource,
          implied_odds: odds,\n          line_verified: lineVerified,\n          line_source: lineSource,\n          line_checked_at: timestamp,\n          key_metric_used: gameMarket ? 'two-sided no-vig market consensus probability' : label,
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
  output.push('_Player props prefer primary/consensus lines and label alternates. Moneyline confidence is explicitly two-sided no-vig market probability, not an independent team-performance forecast._');
  if (sgpLegs.length) {
    output.push(''); output.push('```sgp'); output.push(JSON.stringify({ legs: sgpLegs })); output.push('```');
  }
  for (const log of logs) {
    output.push(''); output.push('[PREDICTION_LOG]'); output.push(JSON.stringify(log));
  }
  return output.join('\n');
}
