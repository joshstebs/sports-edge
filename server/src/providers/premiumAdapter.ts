export interface PremiumProviderStatus {
  provider: string;
  configured: boolean;
  sports: string[];
  purpose: string;
  reason: string;
}

/**
 * Premium feeds are optional enrichments, never hard dependencies. We expose
 * explicit extension points instead of silently inventing integrations or
 * requiring paid providers when the official/free stack is sufficient.
 */
export function premiumProviderStatus(): PremiumProviderStatus[] {
  return [
    {
      provider: 'sportradar',
      configured: Boolean(process.env.SPORTRADAR_API_KEY),
      sports: ['nba', 'nfl', 'nhl'],
      purpose: 'advanced player/team context and commercial-grade redundancy',
      reason: process.env.SPORTRADAR_API_KEY
        ? 'credential present; sport-specific adapter may be enabled after licensed endpoint validation'
        : 'optional; free/official sources remain primary',
    },
    {
      provider: 'premium-odds',
      configured: Boolean(process.env.PREMIUM_ODDS_API_KEY),
      sports: ['mlb', 'nba', 'nfl', 'nhl'],
      purpose: 'deeper prop coverage, line history and multi-book consensus',
      reason: process.env.PREMIUM_ODDS_API_KEY
        ? 'credential present; enable only against a configured licensed provider endpoint'
        : 'optional; The Odds API / SportsGameOdds / ESPN odds remain the fallback chain',
    },
  ];
}

export function dataGapPriorities(): Record<string, string[]> {
  return {
    mlb: ['official MLB Stats API', 'Baseball Savant/Statcast', 'odds consensus', 'weather/park context'],
    nba: ['ESPN recent game logs', 'API-Sports season context when healthy', 'minutes/usage enrichment', 'odds consensus'],
    nfl: ['ESPN recent game logs', 'API-Sports season/injury context when healthy', 'snap/route/target-share enrichment', 'odds consensus'],
    nhl: ['ESPN/NHL recent game logs', 'ice-time/power-play enrichment', 'goalie confirmation', 'odds consensus'],
  };
}
