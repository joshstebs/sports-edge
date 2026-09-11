import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDesignation,
  designationChanges,
  designationWeight,
  isUnavailable,
  latestWeeklyReports,
  mergeInjuryEntries,
  mlbEntriesFromRoster,
  nflverseEntriesFromRows,
  parseCsvRecords,
  type InjuryFeedEntry,
} from '../src/providers/injuryFeeds.js';
import { buildReportEntries } from '../src/providers/injuryReport.js';

// --- designation normalization --------------------------------------------

test('classifies ESPN, NFL and MLB designation labels onto one enum', () => {
  assert.equal(classifyDesignation('Out'), 'out');
  assert.equal(classifyDesignation('Day-To-Day'), 'day_to_day');
  assert.equal(classifyDesignation('Questionable'), 'questionable');
  assert.equal(classifyDesignation('Doubtful'), 'doubtful');
  assert.equal(classifyDesignation('Probable'), 'probable');
  assert.equal(classifyDesignation('Injured Reserve'), 'injured_list');
  assert.equal(classifyDesignation('10-Day-IL'), 'injured_list');
  assert.equal(classifyDesignation('60-Day-IL'), 'injured_list');
  assert.equal(classifyDesignation('Injured 60-Day'), 'injured_list');
  assert.equal(classifyDesignation('Suspension'), 'suspended');
  assert.equal(classifyDesignation('Active'), 'active');
  // Unrecognised labels must not be coerced into a real status.
  assert.equal(classifyDesignation('Bereavement'), 'unknown');
  assert.equal(classifyDesignation(''), 'unknown');
  assert.equal(classifyDesignation(undefined), 'unknown');
});

test('availability weights are ordered and only real designations block', () => {
  assert.equal(designationWeight('out'), 1);
  assert.equal(designationWeight('injured_list'), 1);
  assert.ok(designationWeight('doubtful') < designationWeight('out'));
  assert.ok(designationWeight('questionable') < designationWeight('doubtful'));
  assert.ok(designationWeight('day_to_day') < designationWeight('questionable'));
  assert.ok(designationWeight('day_to_day') > 0);
  assert.equal(designationWeight('active'), 0);
  assert.equal(designationWeight('unknown'), 0);
  assert.equal(isUnavailable('out'), true);
  assert.equal(isUnavailable('day_to_day'), false);
});

// --- nflverse CSV ----------------------------------------------------------

function csv(...rows: string[]) {
  return `season,season_type,game_type,team,week,gsis_id,position,full_name,first_name,last_name,report_primary_injury,report_status,practice_primary_injury,practice_secondary_injury,practice_status\n${rows.join('\n')}`;
}

test('parses quoted CSV fields without splitting on embedded commas', () => {
  const rows = parseCsvRecords(`a,b\n"x, y",2\n`);
  assert.deepEqual(rows, [{ a: 'x, y', b: '2' }]);
});

test('keeps only each player\'s most recent week, preferring a real designation', () => {
  const rows = parseCsvRecords(csv(
    '2026,REG,REG,KC,1,00-1,QB,Patrick Mahomes,Patrick,Mahomes,Ankle,Questionable,Ankle,Limited Participation in Practice',
    '2026,REG,REG,KC,2,00-1,QB,Patrick Mahomes,Patrick,Mahomes,Ankle,Out,Ankle,Did Not Participate In Practice',
    '2026,REG,REG,KC,2,00-1,QB,Patrick Mahomes,Patrick,Mahomes,Ankle,,Ankle,Did Not Participate In Practice',
  ));
  const latest = latestWeeklyReports(rows);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].week, '2');
  assert.equal(latest[0].report_status, 'Out');
});

test('maps practice-only rows to a conservative designation and never to healthy', () => {
  const entries = nflverseEntriesFromRows(parseCsvRecords(csv(
    '2026,REG,REG,WAS,1,00-2,RB,Jacory Croskey-Merritt,Jacory,Croskey-Merritt,,,Groin,,Limited Participation in Practice',
    '2026,REG,REG,DAL,1,00-3,WR,CeeDee Lamb,CeeDee,Lamb,Shoulder,Questionable,Shoulder,Did Not Participate In Practice',
  )));
  const was = entries.find((e) => e.playerName === 'Jacory Croskey-Merritt')!;
  assert.equal(was.designation, 'questionable');
  assert.equal(was.injury, 'Groin');
  const dal = entries.find((e) => e.playerName === 'CeeDee Lamb')!;
  assert.equal(dal.designation, 'questionable'); // game designation wins over practice
  assert.equal(dal.week, 1);
});

test('drops rows with no usable status instead of inventing one', () => {
  const entries = nflverseEntriesFromRows(parseCsvRecords(csv(
    '2026,REG,REG,SF,1,00-4,TE,Someone Quiet,Someone,Quiet,,,,Full Participation in Practice',
  )));
  assert.equal(entries.length, 0);
});

// --- MLB IL ---------------------------------------------------------------

test('MLB roster status keeps only real IL designations, dropping active/minor moves', () => {
  const entries = mlbEntriesFromRoster([
    { person: { id: 1, fullName: 'Active Guy' }, status: { code: 'A', description: 'Active' } },
    { person: { id: 2, fullName: 'Hurt Guy' }, status: { code: 'D60', description: 'Injured 60-Day' }, position: { abbreviation: 'RF' } },
    { person: { id: 3, fullName: 'Optioned Guy' }, status: { code: 'RM', description: 'Reassigned to Minors' } },
    { person: { id: 4, fullName: 'IL Guy' }, status: { code: 'D10', description: 'Injured 10-Day' } },
  ], 'New York Yankees', 147);
  assert.deepEqual(entries.map((e) => e.playerName), ['Hurt Guy', 'IL Guy']);
  assert.equal(entries[0].designation, 'injured_list');
  assert.equal(entries[0].position, 'RF');
  assert.equal(entries[0].source, 'statsapi.mlb.com');
});

// --- merge + change tracking ---------------------------------------------

function entry(over: Partial<InjuryFeedEntry>): InjuryFeedEntry {
  return {
    playerName: 'Player One',
    team: 'BOS',
    position: 'OF',
    designation: 'questionable',
    designationRaw: 'Questionable',
    injury: null,
    detail: null,
    week: null,
    statusDate: null,
    source: 'src',
    ...over,
  };
}

test('merge keeps the more severe designation and preserves both sources', () => {
  const merged = mergeInjuryEntries([
    entry({ playerName: 'Corbin Carroll', designation: 'day_to_day', injury: 'Back', source: 'espn' }),
    entry({ playerName: 'Corbin Carroll', designation: 'injured_list', injury: null, detail: 'Injured 10-Day', source: 'statsapi' }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].designation, 'injured_list');
  assert.equal(merged[0].injury, 'Back'); // comment/injury from the less severe source survives
  assert.equal(merged[0].detail, 'Injured 10-Day');
  assert.equal(merged[0].source, 'espn + statsapi');
});

test('merge is name-normalized so accents and suffixes do not duplicate a player', () => {
  const merged = mergeInjuryEntries([
    entry({ playerName: 'Ronald Acuña Jr.', source: 'espn' }),
    entry({ playerName: 'Ronald Acuna', source: 'nflverse' }),
  ]);
  assert.equal(merged.length, 1);
});

test('designation changes report real transitions with the provider timestamp', () => {
  const changes = designationChanges(
    [entry({ playerName: 'Josh Allen', designation: 'out' })],
    [entry({ playerName: 'Josh Allen', designation: 'day_to_day', statusDate: '2026-09-11T01:27Z' })],
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].from, 'out');
  assert.equal(changes[0].to, 'day_to_day');
  assert.equal(changes[0].changedAt, '2026-09-11T01:27Z');
});

test('designation changes stay empty when nothing moved, and never invent a timestamp', () => {
  assert.equal(designationChanges([entry({})], [entry({})]).length, 0);
  const moved = designationChanges([entry({ designation: 'questionable' })], [entry({ designation: 'out' })]);
  assert.equal(moved[0].changedAt, null);
  // A player seen for the first time is not a change.
  assert.equal(designationChanges([], [entry({})]).length, 0);
});

// --- report composition ---------------------------------------------------

test('buildReportEntries merges ESPN analyst detail with a more severe feed status', () => {
  const espnEntries = [{
    id: '1024940',
    playerId: '42404',
    playerName: 'Corbin Carroll',
    teamId: '29',
    teamName: 'Arizona Diamondbacks',
    status: 'Day-To-Day',
    date: '2026-09-11T01:27Z',
    shortComment: 'Carroll (back) underwent an MRI.',
    longComment: 'Expected back Friday.',
    type: 'Back',
    detail: null,
    returnDate: null,
  }];
  const feedEntries = [entry({
    playerName: 'Corbin Carroll',
    team: 'Arizona Diamondbacks',
    designation: 'injured_list',
    designationRaw: 'Injured 10-Day',
    source: 'statsapi.mlb.com',
  })];
  const report = buildReportEntries(espnEntries, feedEntries);
  assert.equal(report.length, 1);
  assert.equal(report[0].designation, 'injured_list');
  assert.equal(report[0].shortComment, 'Carroll (back) underwent an MRI.');
  assert.equal(report[0].changedAt, '2026-09-11T01:27Z');
  assert.equal(report[0].unavailable, true);
  assert.match(report[0].source, /espn/);
  assert.match(report[0].source, /statsapi/);
});

test('buildReportEntries leaves ESPN-only players untouched', () => {
  const report = buildReportEntries([{
    id: '1', playerId: '9', playerName: 'Solo Player', teamId: null, teamName: 'Team',
    status: 'Out', date: null, shortComment: null, longComment: null, type: null, detail: null, returnDate: null,
  }], []);
  assert.equal(report.length, 1);
  assert.equal(report[0].designation, 'out');
  assert.equal(report[0].unavailable, true);
});
