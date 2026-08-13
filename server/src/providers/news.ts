// ESPN news provider — real headlines for injury/lineup context.
// Host note: site.api.espn.com is 403-blocked from some networks (verified);
// the same API works on site.web.api.espn.com (verified 200, live articles).

const SOURCE = 'site.web.api.espn.com (ESPN news)';
const BASE = 'https://site.web.api.espn.com/apis/site/v2/sports';

const LEAGUE_PATHS: Record<string, string> = {
  mlb: 'baseball/mlb',
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface NewsArticle {
  headline: string;
  description: string;
  published: string | null;
  type: string;
  url: string | null;
  mentionsPlayer: boolean;
}

export interface NewsResult {
  available: boolean;
  reason?: string;
  source: string;
  sport: string;
  articles: NewsArticle[];
  matchedPlayer: string | null;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
}

function mentionsPlayer(headline: string, description: string, playerName: string): boolean {
  const tokens = Array.from(new Set(tokenize(playerName)));
  if (tokens.length === 0) return false;
  const hay = `${headline} ${description}`.toLowerCase();
  // match last-name token (most distinctive) or the full name; first-name-only is too noisy
  const last = tokens[tokens.length - 1];
  const first = tokens[0];
  if (last && last.length >= 3 && hay.includes(last)) return true;
  if (first && first.length >= 3 && tokens.length > 1 && hay.includes(`${first} ${last}`)) return true;
  return false;
}

export async function getLeagueNews(
  sportKey: string,
  playerName?: string,
  limit = 10
): Promise<NewsResult> {
  const sport = LEAGUE_PATHS[sportKey.toLowerCase()];
  if (!sport) {
    return {
      available: false,
      reason: `unsupported sport "${sportKey}" (use mlb, nfl, nba or nhl)`,
      source: SOURCE,
      sport: sportKey,
      articles: [],
      matchedPlayer: null,
    };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${BASE}/${sport}/news`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!res.ok) {
      return {
        available: false,
        reason: `ESPN news HTTP ${res.status}`,
        source: SOURCE,
        sport: sportKey,
        articles: [],
        matchedPlayer: null,
      };
    }
    const data: any = await res.json();
    const raw: any[] = Array.isArray(data?.articles) ? data.articles : [];
    const articles: NewsArticle[] = raw.slice(0, limit).map((a) => ({
      headline: String(a.headline ?? '').slice(0, 200),
      description: String(a.description ?? '').slice(0, 300),
      published: a.published ? String(a.published).slice(0, 10) : null,
      type: a.type ?? 'Article',
      url: a.links?.web?.href ?? a.links?.mobile?.href ?? null,
      mentionsPlayer: playerName ? mentionsPlayer(String(a.headline ?? ''), String(a.description ?? ''), playerName) : false,
    }));
    const filtered = playerName ? articles.filter((a) => a.mentionsPlayer) : articles;
    return {
      available: true,
      source: SOURCE,
      sport: sportKey,
      articles: filtered.length ? filtered : articles,
      matchedPlayer: playerName ?? null,
    };
  } catch (e) {
    return {
      available: false,
      reason: `ESPN news fetch failed: ${(e as Error).message}`,
      source: SOURCE,
      sport: sportKey,
      articles: [],
      matchedPlayer: null,
    };
  }
}
