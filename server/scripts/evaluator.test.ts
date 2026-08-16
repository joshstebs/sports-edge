import assert from 'node:assert/strict';
import { buildLearningContext, evaluateLeg, gameMatchesMatchup, inferMarket, parseLineAndSide } from '../src/lib/evaluator.js';
import { normalizePrediction, type Prediction } from '../src/lib/predictionStore.js';
import { extractPredictionLogs } from '../src/routes/chat.js';

const game = {
  teams: {
    away: { team: { name: 'Toronto Blue Jays', abbreviation: 'TOR' }, score: 4 },
    home: { team: { name: 'New York Yankees', abbreviation: 'NYY' }, score: 2 },
  },
};
const box = {
  teams: {
    away: { players: {
      ID123: { person: { id: 123, fullName: 'Vladimir Guerrero Jr.' }, stats: { batting: { hits: 2, doubles: 1, triples: 0, homeRuns: 1, rbi: 2, runs: 1 } } },
    } },
    home: { players: {} },
  },
};

assert.equal(gameMatchesMatchup(game, 'Blue Jays vs Yankees'), true);
assert.equal(gameMatchesMatchup(game, 'Mets vs Yankees'), false);
assert.equal(inferMarket({ leg_name: 'Vladimir Guerrero Jr. over 1.5 Total Bases', target_line: '1.5' }), 'totalBases');
assert.deepEqual(parseLineAndSide({ leg_name: 'Player UNDER 5.5 strikeouts', target_line: '5.5' }), { line: 5.5, side: 'under' });
assert.deepEqual(parseLineAndSide({ leg_name: 'Player prop', target_line: '', market: 'hits', side: 'over', line: 0.5 }), { line: 0.5, side: 'over' });

const totalBases = evaluateLeg({ leg_name: 'Vladimir Guerrero Jr. OVER 1.5 Total Bases', target_line: '1.5', player_id: 123 }, box, game);
assert.deepEqual(totalBases, { outcome: 'won', actual: 6 });
assert.equal(evaluateLeg({ leg_name: 'Unknown Player OVER 0.5 hits', target_line: '0.5' }, box, game).outcome, 'push');
assert.equal(evaluateLeg({ leg_name: 'Vladimir Guerrero Jr. OVER 1.5 fantasy points', target_line: '1.5', player_id: 123 }, box, game).outcome, 'ungraded');

const base: Prediction = {
  prediction_id: 'p1', userId: 'admin', timestamp: '2026-08-15T12:00:00Z', sport: 'MLB', matchup: 'Blue Jays vs Yankees',
  bet_type: 'PROP', status: 'evaluated', legs: [
    { leg_name: 'A over 0.5 hits', target_line: '0.5', implied_odds: '-110', model_probability: '70', outcome: 'won' },
    { leg_name: 'B over 0.5 hits', target_line: '0.5', implied_odds: null, model_probability: '60', outcome: 'lost' },
    { leg_name: 'C over 0.5 hits', target_line: '0.5', outcome: 'push' },
    { leg_name: 'D mystery', target_line: '', outcome: 'ungraded' },
  ],
};
const learning = buildLearningContext([base], new Date('2026-08-16T12:00:00Z'));
assert.equal(learning.evaluated, 2);
assert.equal(learning.pushes, 1);
assert.equal(learning.priced, 1);
assert.equal(learning.roi, 90.9);
assert.equal(learning.adaptiveRules.length, 0, 'small samples must not change confidence');

const logText = `text\n[PREDICTION_LOG]\n\`\`\`json\n{"prediction_id":"same","legs":[{"leg_name":"A {brace}","target_line":"0.5"}]}\n\`\`\`\nmore\n[PREDICTION_LOG]{"prediction_id":"same","legs":[{"leg_name":"B","target_line":"1.5"}]}`;
assert.equal(extractPredictionLogs(logText).length, 2);
const one = normalizePrediction({ ...extractPredictionLogs(logText)[0], timestamp: '2026-08-16T12:00:00Z' });
const two = normalizePrediction({ ...extractPredictionLogs(logText)[1], timestamp: '2026-08-16T12:00:00Z' });
assert.notEqual(one.prediction_id, two.prediction_id, 'reused model IDs must not discard different picks');
const adminCopy = normalizePrediction({ ...extractPredictionLogs(logText)[0], userId: 'admin-user', timestamp: '2026-08-16T12:00:00Z' });
const testerCopy = normalizePrediction({ ...extractPredictionLogs(logText)[0], userId: 'tester-user', timestamp: '2026-08-16T12:00:00Z' });
assert.notEqual(adminCopy.prediction_id, testerCopy.prediction_id, 'prediction IDs must be scoped by user ownership');

console.log('evaluator tests passed');
