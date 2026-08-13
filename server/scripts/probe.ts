// Live provider probe — run with: pnpm probe (tsx scripts/probe.ts)
// Calls every data source and prints REAL results.

import * as mlb from '../src/providers/mlbStatsApi.js';
import * as savant from '../src/providers/savant.js';
import * as espn from '../src/providers/espn.js';
import * as odds from '../src/providers/oddsApi.js';
import * as weather from '../src/providers/weather.js';
import { executeTool } from '../src/llm/toolRegistry.js';

const show = (label: string, obj: any, keys?: string[]) => {
  console.log(`\n=== ${label} ===`);
  if (!obj) return console.log('  (null)');
  if (keys) {
    const picked: any = {};
    for (const k of keys) if (k in obj) picked[k] = obj[k];
    console.log(' ', JSON.stringify(picked).slice(0, 600));
  } else {
    console.log(' ', JSON.stringify(obj).slice(0, 600));
  }
};

const d = new Date();
const tomorrow = new Date(d.getTime() + 86400000).toISOString().slice(0, 10);

async function main() {
  // 1. batter via tool pipeline (search -> season -> gameLog -> splits)
  const batter = await executeTool('mlb_batter_stats', { name: 'Vladimir Guerrero Jr.' });
  show('mlb_batter_stats(Vladimir Guerrero Jr.)', JSON.parse(batter.json), [
    'player', 'seasonStats', 'last15Rolling', 'platoonSplits', 'available', 'reason',
  ]);

  // 2. pitcher
  const pitcher = await executeTool('mlb_pitcher_stats', { name: 'Kevin Gausman' });
  const pj = JSON.parse(pitcher.json);
  show('mlb_pitcher_stats(Kevin Gausman)', pj, [
    'player', 'seasonStats', 'last10Aggregate', 'last10Starts', 'platoonSplits', 'available', 'reason',
  ]);

  // 3. savant advanced metrics
  const adv = await savant.getAdvancedMetrics('Vladimir Guerrero Jr.');
  show('mlb_advanced_metrics(Vladimir Guerrero Jr.)', adv, ['playerName', 'xwoba', 'xba', 'xslg', 'barrelRate', 'hardHitRate', 'available', 'reason']);

  // 4. weather Rogers Centre tomorrow
  const wx = await weather.getWeather('Rogers Centre', null, tomorrow);
  show(`game_weather(Rogers Centre, ${tomorrow})`, wx, ['venue', 'hour', 'tempF', 'windMph', 'windDir', 'precipPct', 'available', 'reason']);

  // 5. odds (no key configured -> honest unavailable)
  const od = await odds.getGameOdds('Toronto Blue Jays', 'Houston Astros', 'mlb');
  show('game_odds(Blue Jays vs Astros, mlb)', od, ['available', 'reason', 'event', 'remaining']);

  // 6. ESPN NBA gamelog for SGA (id discovered via rosters)
  const sga = await espn.findPlayer('Shai Gilgeous-Alexander', 'basketball/nba');
  show('espn findPlayer(SGA)', sga, ['available', 'reason', 'player']);
  if (sga.available && sga.player) {
    const gl = await espn.getGamelog(sga.player.id, 'basketball/nba', 3);
    const gj: any = { ...gl };
    if (gl.available && gl.games) {
      gj.games = gl.games.map((g) => ({
        gameDate: g.gameDate,
        opponent: g.opponent,
        score: g.score,
        result: g.result,
        stats: g.stats,
      }));
    }
    show('espn_gamelog(SGA, nba, 3)', gj, ['season', 'games', 'available', 'reason']);
  }

  // 7. MLB schedule today
  const sched = await mlb.getSchedule(d.toISOString().slice(0, 10), d.toISOString().slice(0, 10));
  show('mlb_schedule(today)', sched, ['available', 'reason']);
  if (sched.available && sched.data) {
    console.log('  games:', sched.data.map((g) => `${g.away.name} @ ${g.home.name} (${g.awayProbable ?? 'TBD'} vs ${g.homeProbable ?? 'TBD'}, ${g.venue})`).join(' | ').slice(0, 800));
  }

  // 8. team efficiency (NBA pace + NFL ypp)
  const nbaEff = await espn.getTeamStats('basketball/nba', 'Oklahoma City Thunder');
  show('team_efficiency(NBA, OKC)', nbaEff, ['team', 'pace', 'offense', 'defense', 'available', 'reason']);
  const nflEff = await espn.getTeamStats('football/nfl', 'Buffalo Bills');
  show('team_efficiency(NFL, Bills)', nflEff, ['team', 'offense', 'defense', 'available', 'reason']);

  // 9. lineups (today's first game — pre-game -> honest 'not yet posted')
  if (sched.available && sched.data && sched.data[0]) {
    const lu = await executeTool('mlb_lineups', { gamePk: sched.data[0].gamePk });
    show(`mlb_lineups(gamePk ${sched.data[0].gamePk})`, JSON.parse(lu.json), ['status', 'lineupsPosted', 'note', 'away', 'home', 'available', 'reason']);
  }
}

main().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exit(1);
});
