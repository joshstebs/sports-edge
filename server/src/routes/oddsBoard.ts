import { Router } from 'express';
import { getUpcomingOddsEvents, getGameOdds, parseAmerican } from '../providers/espnOdds.js';
import { getBookmakerBoard } from '../providers/oddsApi.js';
import { isAmericanPrice } from '../providers/oddsBoard.js';
import type { GameOddsSnapshot, OddsBoard, OddsBoardMarket, OddsBoardSport } from '../workspace.js';

export const oddsBoardRouter = Router();
const sports = new Set<unknown>(['nba', 'nfl', 'nhl', 'mlb']);
const TTL = 90_000;
const boards = new Map<OddsBoardSport, { expires: number; result: Promise<OddsBoard> }>();
const snapshots = new Map<string, { expires: number; result: Promise<GameOddsSnapshot> }>();

function cached<Key, Data>(
  storage: Map<Key, { expires: number; result: Promise<Data> }>,
  key: Key,
  load: () => Promise<Data>,
): Promise<Data> {
  const now = Date.now();
  const existing = storage.get(key);
  if (existing && existing.expires > now) return existing.result;
  for (const [id, row] of storage) {
    if (row.expires <= now) storage.delete(id);
  }
  const result = load();
  storage.set(key, { expires: now + TTL, result });
  return result;
}

function loadBoard(sport: OddsBoardSport): Promise<OddsBoard> {
  return cached(boards, sport, async () => {
    const bookmakerEvents = await getBookmakerBoard(sport).catch(() => []);
    if (bookmakerEvents.length) return { source: 'the-odds-api', events: bookmakerEvents };
    try {
      return { source: 'espn', events: await getUpcomingOddsEvents(sport) };
    } catch {
      return { source: 'unavailable', events: [] };
    }
  });
}

function espnSnapshot(sport: OddsBoardSport, event: OddsBoard['events'][number]): Promise<GameOddsSnapshot> {
  return cached(snapshots, `${sport}:${event.id}`, async () => {
    const quote = await getGameOdds(undefined, undefined, sport, undefined, event);
    const selections: GameOddsSnapshot['selections'] = [];
    const add = (market: OddsBoardMarket, name: string, line: string | null | undefined, price: string | null | undefined) => {
      const odds = /^(?:even|evens)$/i.test(String(price ?? '').trim()) ? 100 : parseAmerican(price);
      const point = line != null && String(line).trim() ? Number(line) : null;
      if (!isAmericanPrice(odds) || (market !== 'h2h' && (point === null || !Number.isFinite(point)))) return;
      selections.push({ market, name, line: point, quotes: [{ book: quote.provider || 'ESPN feed', odds, updatedAt: null }] });
    };

    if (quote.available && Date.parse(event.commenceTime) > Date.now()) {
      add('h2h', event.home, null, quote.moneyline?.home);
      add('h2h', event.away, null, quote.moneyline?.away);
      add('spreads', event.home, quote.runline?.homeLine, quote.runline?.homeOdds);
      add('spreads', event.away, quote.runline?.awayLine, quote.runline?.awayOdds);
      add('totals', 'Over', quote.total?.line, quote.total?.overOdds);
      add('totals', 'Under', quote.total?.underLine, quote.total?.underOdds);
    }
    return { observedAt: quote.retrievedAt, selections };
  });
}

oddsBoardRouter.get('/', async (req, res) => {
  const sport = req.query.sport;
  if (typeof sport !== 'string' || !sports.has(sport)) {
    res.status(400).json({ error: 'Choose NBA, NFL, NHL, or MLB.' });
    return;
  }
  const board = await loadBoard(sport as OddsBoardSport);
  res.json({ ...board, events: board.events.filter(event => Date.parse(event.commenceTime) > Date.now()) });
});

oddsBoardRouter.get('/game', async (req, res) => {
  const { sport, event: id } = req.query;
  if (typeof sport !== 'string' || !sports.has(sport) || typeof id !== 'string' || !/^\d{1,18}$/.test(id)) {
    res.status(400).json({ error: 'Choose an upcoming game from the board.' });
    return;
  }
  const league = sport as OddsBoardSport;
  const board = await loadBoard(league);
  const event = board.source === 'espn' && board.events.find(row => row.id === id);
  if (!event || Date.parse(event.commenceTime) <= Date.now()) {
    res.status(404).json({ error: 'This game is no longer listed on the ESPN board.' });
    return;
  }
  const snapshot = await espnSnapshot(league, event);
  res.json(Date.parse(event.commenceTime) > Date.now() ? snapshot : { ...snapshot, selections: [] });
});
