export function marketLabel(value: unknown): string {
  const key = String(value ?? '').trim();
  const labels: Record<string, string> = {
    hits: 'Hits', totalBases: 'Total Bases', homeRuns: 'Home Runs', rbi: 'RBIs', runs: 'Runs',
    strikeouts: 'Strikeouts', outsRecorded: 'Outs Recorded', passingYards: 'Passing Yards',
    passingTouchdowns: 'Passing Touchdowns', rushingYards: 'Rushing Yards',
    rushingAttempts: 'Rushing Attempts', receivingYards: 'Receiving Yards',
    receptions: 'Receptions', receivingTargets: 'Receiving Targets',
    rushingReceivingYards: 'Rushing + Receiving Yards', touchdowns: 'Anytime Touchdowns',
    points: 'Points', rebounds: 'Rebounds', assists: 'Assists', threePointersMade: '3-Pointers',
    pointsReboundsAssists: 'Points + Rebounds + Assists',
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
 * NBA and NFL player props may be displayed as research-only statistical picks.
 * Only an explicit research marker qualifies: an unpriced or stale offer in a
 * direct fixture stays in the verified pool so downstream line verification can
 * block it rather than silently re-labeling it as research.
 */
function isResearchCandidate(candidate: any): boolean {
  const sport = String(candidate?.sport ?? '').toLowerCase();
  if (sport !== 'nba' && sport !== 'nfl') return false;
  if (isGameMarket(candidate)) return false;
  return candidate?.recommendationType === 'research' || candidate?.researchOnly === true;
}

function statNumber(value: unknown, digits = 1): string {
  const number = Number(value);
  if (value == null || !Number.isFinite(number)) return 'n/a';
  return Number.isInteger(number) ? String(number) : number.toFixed(digits);
}

function percent(value: unknown): string {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? 'n/a' : `${Math.round(number * 100)}%`;
}

function renderResearchCandidate(candidate: any, index: number): string[] {
  const market = marketLabel(candidate?.market);
  const direction = String(candidate?.side ?? candidate?.direction ?? 'over').toUpperCase();
  const threshold = candidate?.historicalThreshold ?? candidateLine(candidate);
  const matchup = String(
    candidate?.matchupContext
      ?? `${candidate?.team ?? ''} ${candidate?.homeAway === 'away' ? '@' : 'vs'} ${candidate?.opponent ?? ''}`,
  ).trim();
  const gameDate = candidate?.gameDate ?? candidate?.eventDate;
  const lines: string[] = [
    `${index + 1}. **${candidate?.player ?? 'Player'}** (${matchup}${gameDate ? ` · ${gameDate}` : ''}) — ${direction} ${statNumber(threshold)} ${market} — **Research Pick — Odds Unavailable**`,
  ];

  const form = [
    `L5 ${statNumber(candidate?.l5Average)}`,
    `L10 ${statNumber(candidate?.l10Average)}`,
    `season/sample ${statNumber(candidate?.seasonAverage)}${candidate?.seasonSampleSize ? ` (${candidate.seasonSampleSize} g)` : ''}`,
  ];
  if (candidate?.trendLabel) {
    form.push(`${candidate.trendLabel} trend${candidate?.trend != null ? ` (${candidate.trend > 0 ? '+' : ''}${statNumber(candidate.trend)})` : ''}`);
  }
  if (candidate?.minutesL5 != null) form.push(`minutes L5 ${statNumber(candidate.minutesL5)}`);
  if (candidate?.usageL5 != null) form.push(`usage L5 ${statNumber(candidate.usageL5)}`);
  if (candidate?.consistencyLabel) {
    form.push(`consistency ${candidate.consistencyLabel}${candidate?.consistencyStdDev != null ? ` (σ ${statNumber(candidate.consistencyStdDev)})` : ''}`);
  }
  lines.push(`   _${form.join(' · ')}_`);

  if (Array.isArray(candidate?.recentGames) && candidate.recentGames.length) {
    const games = candidate.recentGames
      .map((game: any, gameIndex: number) => {
        const label = `G${gameIndex + 1}`;
        const value = statNumber(game?.value);
        const opponent = game?.opponent ? ` ${game.opponent}` : '';
        return `${label} ${value}${opponent}`;
      })
      .join(' · ');
    lines.push(`   _last ${candidate.recentGames.length}: ${games}_`);
  }

  const wins = Number(candidate?.historicalWins ?? 0);
  const losses = Number(candidate?.historicalLosses ?? 0);
  const pushes = Number(candidate?.historicalPushes ?? 0);
  const thresholdParts = [
    `historical threshold ${statNumber(threshold)} (NOT a sportsbook line)`,
    candidate?.hitFrequency != null ? `hit ${wins}/${wins + losses} decisions (${percent(candidate.hitFrequency)})` : null,
    pushes ? `${pushes} push${pushes === 1 ? '' : 'es'}` : null,
    candidate?.dataDate ? `data through ${candidate.dataDate}` : null,
  ].filter(Boolean);
  lines.push(`   _${thresholdParts.join(' · ')}_`);

  if (candidate?.projection != null) {
    const range = candidate?.projectionLow != null && candidate?.projectionHigh != null
      ? ` (range ${statNumber(candidate.projectionLow)}–${statNumber(candidate.projectionHigh)})`
      : '';
    const source = String(candidate?.historicalThresholdSource ?? '').trim();
    lines.push(`   _projection ${statNumber(candidate.projection)}${range}${source ? ` · threshold: ${source}` : ''}_`);
  }

  const opponentParts = [
    candidate?.opponentSampleSize
      ? `vs ${candidate?.opponent ?? 'opponent'}: ${candidate.opponentSampleSize} g, ${statNumber(candidate.opponentAverage)} avg`
      : null,
    candidate?.homeAway ? `${candidate.homeAway === 'home' ? 'home' : 'away'} matchup` : null,
  ].filter(Boolean);
  if (opponentParts.length) lines.push(`   _${opponentParts.join(' · ')}_`);
  lines.push('   _opponent defensive ranking vs this position: not available from the current feed — player history shown instead_');

  if (candidate?.usedPriorSeason && candidate?.priorSeasonSampleSize) {
    lines.push(`   _prior-season context${candidate?.priorSeasonLabel ? ` (${candidate.priorSeasonLabel})` : ''}: ${statNumber(candidate.priorSeasonAverage)} avg over ${candidate.priorSeasonSampleSize} g — NOT part of current-season L5/L10_`);
  }
  if (candidate?.availabilityNote) lines.push(`   _⚠️ ${candidate.availabilityNote}_`);
  if (candidate?.source) lines.push(`   _source: ${candidate.source}_`);
  if (candidate?.rationale) lines.push(`   _${candidate.rationale}_`);
  return lines;
}

export interface ScreenerMeta {
  insufficientSamples?: number;
  minimumSample?: number;
  priceProviderAvailable?: boolean;
  priceProviderReason?: string;
  gates?: {
    playerMarketsConsidered?: number;
    noGameHistory?: number;
    insufficientSample?: number;
    insufficientCurrentSample?: number;
    modelUnavailable?: number;
    belowConfidence?: number;
    duplicatePlayer?: number;
    injuryExcluded?: number;
  };
}

/**
 * Render screener rows into prose plus the same structured blocks consumed by
 * the chat route. This closes a historical gap where fast-screened picks were
 * visible to the user but never entered PREDICTION_LOG, so they could not be
 * graded the next morning.
 */
export function renderScreenerSummaryBlocks(
  candidates: any[],
  requested: number,
  meta: ScreenerMeta = {},
): string {
  const safeRequested = Math.max(1, Math.floor(Number(requested) || 1));
  // Keep a wider structured pool so server-side availability, line, and quality
  // gates can backfill rejected top rows without asking the model to invent more.
  const poolSize = Math.max(1, safeRequested * 2, safeRequested + 4);
  const all = Array.isArray(candidates) ? candidates : [];
  const verifiedPool: any[] = [];
  const researchPool: any[] = [];
  for (const candidate of all) {
    if (isResearchCandidate(candidate)) researchPool.push(candidate);
    else verifiedPool.push(candidate);
  }
  const verifiedTop = verifiedPool.slice(0, poolSize);
  const researchSlots = Math.max(0, safeRequested - verifiedTop.length);
  const researchTop = researchPool.slice(0, researchSlots);

  const output: string[] = [];
  const timestamp = new Date().toISOString();
  const anyProvisional = verifiedTop.some((candidate) => String(candidate?.sport ?? '').toLowerCase() === 'mlb' && candidate?.inLineupToday === false);

  if (verifiedTop.length) {
    output.push('**Verified slate screen — ' + verifiedTop.length + ' qualified candidate' + (verifiedTop.length === 1 ? '' : 's') + ' (model grades, live stats).**');
  } else {
    output.push('**No verified sportsbook picks were found.**');
  }
  if (anyProvisional) {
    output.push('');
    output.push('⚠️ **Some MLB batting orders are not posted yet.** Picks marked 🕐 are provisional and are not saved to the learning ledger until final game-day verification.');
  }
  output.push('');

  const sgpLegs: any[] = [];
  const logs: any[] = [];
  verifiedTop.forEach((candidate, index) => {
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

    const qualitySource = String(candidate?.qualitySource ?? candidate?.source ?? '').trim() || null;
    const lineSource = String(candidate?.marketSource ?? candidate?.source ?? '').trim() || null;
    // The render time says nothing about when the sportsbook offer was checked.
    // An unknown or expired quote stays visible as analysis, never a bettable slip.
    const lineCheckedAt = candidate?.marketCheckedAt ?? null;
    const checkedMs = Date.parse(String(lineCheckedAt ?? ''));
    const lineVerified = Boolean(odds != null && lineSource &&
      (gameMarket || candidate?.marketLine != null) &&
      Number.isFinite(checkedMs) && checkedMs <= Date.now() + 60_000 && Date.now() - checkedMs <= 15 * 60_000);
    sgpLegs.push({
      entity_type: gameMarket ? 'team' : 'player',
      ...(gameMarket ? { team: candidate.team, quality_source: qualitySource } : { player_name: candidate.player }),
      sport, game: matchup, game_date: candidate.eventDate, event_id: candidate.eventId, selection,
      market: candidate.market, side: gameMarket ? null : candidate.side, line: gameMarket ? null : line,
      odds, game_odds: null, line_verified: lineVerified, line_source: lineSource, line_checked_at: lineCheckedAt,
      justification: gameMarket
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
          implied_odds: odds,
          line_verified: lineVerified,
          line_source: lineSource,
          line_checked_at: lineCheckedAt,
          key_metric_used: gameMarket ? 'two-sided no-vig market consensus probability' : label,
        }],
        recommended_units: qualityTier === 'core' ? '0.5' : '0.25',
      });
    }
  });

  if (researchTop.length) {
    output.push('');
    output.push('**Research-only statistical picks — NOT verified sportsbook lines.**');
    output.push('_These players did not have a verified sportsbook line with positive modeled edge, so no odds, implied probability or EV are shown. The thresholds below are historical research labels, not bettable lines._');
    output.push('');
    researchTop.forEach((candidate, index) => {
      output.push(...renderResearchCandidate(candidate, index));
    });
  }

  const shown = verifiedTop.length + researchTop.length;
  if (shown < safeRequested) {
    output.push('');
    const g = meta?.gates ?? {};
    const excluded = Number(meta?.insufficientSamples ?? g.insufficientSample ?? 0);
    const minimum = meta?.minimumSample;
    const gateParts: string[] = [];
    if (Number(g.noGameHistory ?? 0) > 0) gateParts.push(`${g.noGameHistory} player-market${g.noGameHistory === 1 ? '' : 's'} had no usable recent game log`);
    if (excluded > 0) gateParts.push(`${excluded} player-market${excluded === 1 ? '' : 's'} were excluded for a sample below the ${minimum ?? 'required'}-game minimum`);
    if (Number(g.insufficientCurrentSample ?? 0) > 0) gateParts.push(`${g.insufficientCurrentSample} lacked at least 3 current-season games (prior-season data is context only)`);
    if (Number(g.modelUnavailable ?? 0) > 0) gateParts.push(`${g.modelUnavailable} lacked a valid model probability`);
    if (Number(g.injuryExcluded ?? 0) > 0) gateParts.push(`${g.injuryExcluded} were excluded because the player is out/inactive on the current injury report`);
    if (Number(g.belowConfidence ?? 0) > 0) gateParts.push(`${g.belowConfidence} scored below the confidence floor`);
    if (Number(g.duplicatePlayer ?? 0) > 0) gateParts.push(`${g.duplicatePlayer} were dropped as a second market for an already-selected player`);
    const providerNote = meta?.priceProviderAvailable === false
      ? ` No live odds provider returned prices (${meta?.priceProviderReason ?? 'unavailable'}), so only research-only picks were possible.`
      : '';
    const gateNote = gateParts.length ? ` Gate detail: ${gateParts.join('; ')}.` : '';
    output.push('⚠️ **Shortfall:** only ' + shown + ' of ' + safeRequested + ' requested picks cleared the evidence floor.' + gateNote + providerNote + ' No picks were padded to reach the target.');
  }
  output.push('');
  output.push('_Player props prefer primary/consensus lines and label alternates. Moneyline confidence is explicitly two-sided no-vig market probability, not an independent team-performance forecast._');
  if (researchTop.length) {
    output.push('_Research-only picks are excluded from slips, odds verification and the verified performance ledger._');
  }
  if (sgpLegs.length) {
    output.push(''); output.push('```sgp'); output.push(JSON.stringify({ legs: sgpLegs })); output.push('```');
  }
  for (const log of logs) {
    output.push(''); output.push('[PREDICTION_LOG]'); output.push(JSON.stringify(log));
  }
  return output.join('\n');
}
