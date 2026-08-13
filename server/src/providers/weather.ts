// Open-Meteo weather (keyless) + static MLB venue coordinate table
// (public knowledge). Hour closest to game time is selected; without an
// explicit game time we assume a 19:00 local evening start (labeled).

const METE = 'https://api.open-meteo.com/v1/forecast';
const SOURCE = 'api.open-meteo.com';

// venue coordinates — public knowledge table, labeled as such
export const VENUE_COORDS: Record<string, { lat: number; lon: number }> = {
  'Rogers Centre': { lat: 43.6414, lon: -79.3894 },
  'Minute Maid Park': { lat: 29.7572, lon: -95.3555 },
  'Yankee Stadium': { lat: 40.8296, lon: -73.9262 },
  'Fenway Park': { lat: 42.3467, lon: -71.0972 },
  'Wrigley Field': { lat: 41.9484, lon: -87.6553 },
  'Guaranteed Rate Field': { lat: 41.8299, lon: -87.6338 },
  'Comerica Park': { lat: 42.339, lon: -83.0485 },
  'Progressive Field': { lat: 41.4957, lon: -81.6852 },
  'Target Field': { lat: 44.9817, lon: -93.2777 },
  'Kauffman Stadium': { lat: 39.0517, lon: -94.4803 },
  'Busch Stadium': { lat: 38.6226, lon: -90.1928 },
  'Great American Ball Park': { lat: 39.0974, lon: -84.5066 },
  'PNC Park': { lat: 40.4468, lon: -80.0057 },
  'Citizens Bank Park': { lat: 39.9055, lon: -75.1665 },
  'Nationals Park': { lat: 38.8729, lon: -77.0074 },
  'Camden Yards': { lat: 39.2839, lon: -76.6216 },
  'Truist Park': { lat: 33.8906, lon: -84.4676 },
  'LoanDepot Park': { lat: 25.7781, lon: -80.2196 },
  'Tropicana Field': { lat: 27.7682, lon: -82.6534 },
  'Globe Life Field': { lat: 32.7514, lon: -97.0831 },
  'Coors Field': { lat: 39.7559, lon: -104.9942 },
  'Chase Field': { lat: 33.4454, lon: -112.0667 },
  'Angel Stadium': { lat: 33.8003, lon: -117.8827 },
  'Dodger Stadium': { lat: 34.0736, lon: -118.2397 },
  'Oracle Park': { lat: 37.7786, lon: -122.3893 },
  'Petco Park': { lat: 32.7076, lon: -117.157 },
  'T-Mobile Park': { lat: 47.5914, lon: -122.3325 },
  'Oakland Coliseum': { lat: 37.7516, lon: -122.2005 },
  'American Family Field': { lat: 43.0284, lon: -87.9712 },
  'Citi Field': { lat: 40.7569, lon: -73.8458 },
};

export const TEAM_VENUE: Record<string, string> = {
  'Toronto Blue Jays': 'Rogers Centre',
  'Houston Astros': 'Minute Maid Park',
  'New York Yankees': 'Yankee Stadium',
  'Boston Red Sox': 'Fenway Park',
  'Chicago Cubs': 'Wrigley Field',
  'Chicago White Sox': 'Guaranteed Rate Field',
  'Detroit Tigers': 'Comerica Park',
  'Cleveland Guardians': 'Progressive Field',
  'Minnesota Twins': 'Target Field',
  'Kansas City Royals': 'Kauffman Stadium',
  'St. Louis Cardinals': 'Busch Stadium',
  'Cincinnati Reds': 'Great American Ball Park',
  'Pittsburgh Pirates': 'PNC Park',
  'Philadelphia Phillies': 'Citizens Bank Park',
  'Washington Nationals': 'Nationals Park',
  'Baltimore Orioles': 'Camden Yards',
  'Atlanta Braves': 'Truist Park',
  'Miami Marlins': 'LoanDepot Park',
  'Tampa Bay Rays': 'Tropicana Field',
  'Texas Rangers': 'Globe Life Field',
  'Colorado Rockies': 'Coors Field',
  'Arizona Diamondbacks': 'Chase Field',
  'Los Angeles Angels': 'Angel Stadium',
  'Los Angeles Dodgers': 'Dodger Stadium',
  'San Francisco Giants': 'Oracle Park',
  'San Diego Padres': 'Petco Park',
  'Seattle Mariners': 'T-Mobile Park',
  'Oakland Athletics': 'Oakland Coliseum',
  'Milwaukee Brewers': 'American Family Field',
  'New York Mets': 'Citi Field',
};

/** Resolve a venue name or team name to a venue name. */
export function resolveVenue(query?: string | null): string | null {
  if (!query) return null;
  const q = query.trim();
  if (VENUE_COORDS[q]) return q;
  if (TEAM_VENUE[q]) return TEAM_VENUE[q];
  // fuzzy: contains
  for (const v of Object.keys(VENUE_COORDS)) {
    if (v.toLowerCase().includes(q.toLowerCase()) || q.toLowerCase().includes(v.toLowerCase())) return v;
  }
  for (const [team, venue] of Object.entries(TEAM_VENUE)) {
    if (team.toLowerCase().includes(q.toLowerCase()) || q.toLowerCase().includes(team.toLowerCase())) return venue;
  }
  return null;
}

function compass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

export interface WeatherResult {
  available: boolean;
  reason?: string;
  source: string;
  venue?: string;
  date?: string | null;
  hour?: string | null;
  tempF?: number | null;
  windMph?: number | null;
  windDir?: string | null;
  precipPct?: number | null;
  note?: string;
}

export async function getWeather(
  venueQuery?: string | null,
  teamQuery?: string | null,
  date?: string | null
): Promise<WeatherResult> {
  try {
    const venue = resolveVenue(venueQuery) ?? resolveVenue(teamQuery);
    if (!venue) {
      return { available: false, reason: `unknown venue/team "${venueQuery ?? teamQuery}"`, source: SOURCE };
    }
    const coords = VENUE_COORDS[venue];
    const url =
      `${METE}?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const hours: string[] = j?.hourly?.time ?? [];
    const tempC: number[] = j?.hourly?.temperature_2m ?? [];
    const windKmh: number[] = j?.hourly?.wind_speed_10m ?? [];
    const windDeg: number[] = j?.hourly?.wind_direction_10m ?? [];
    const precip: number[] = j?.hourly?.precipitation_probability ?? [];
    if (!hours.length) return { available: false, reason: 'Open-Meteo returned no hourly data', source: SOURCE, venue };

    // pick the hour closest to game time (default 19:00 local, labeled)
    const targetHour = date ? `${date}T19:00` : null;
    let idx = targetHour ? hours.findIndex((h) => h.startsWith(targetHour)) : -1;
    if (idx < 0) {
      let best = 0;
      let bestDiff = Infinity;
      const ref = targetHour ? new Date(targetHour).getTime() : new Date().setHours(19, 0, 0, 0);
      hours.forEach((h, i) => {
        const diff = Math.abs(new Date(h).getTime() - ref);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = i;
        }
      });
      idx = best;
    }
    const hour = hours[idx] ?? null;
    return {
      available: true,
      source: SOURCE,
      venue,
      date: hour ? hour.slice(0, 10) : null,
      hour: hour ?? null,
      tempF: tempC[idx] != null ? Math.round(((tempC[idx] * 9) / 5 + 32) * 10) / 10 : null,
      windMph: windKmh[idx] != null ? Math.round(windKmh[idx] * 0.621371 * 10) / 10 : null,
      windDir: windDeg[idx] != null ? compass(windDeg[idx]) : null,
      precipPct: precip[idx] ?? null,
      note: 'hour closest to 19:00 local (typical evening start) when no game time given; C->F and km/h->mph conversions applied',
    };
  } catch (e) {
    return { available: false, reason: `weather fetch failed: ${(e as Error).message}`, source: SOURCE };
  }
}
