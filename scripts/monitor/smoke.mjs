// Read-only production smoke checks for the SportsEdge pilot.
// Does not sign in, place bets, call an LLM or trigger state-changing endpoints.
const ORIGIN = 'https://sportsedge.harbourandmain.com';
const results = [];

async function inspect(name, path, validate) {
  try {
    const response = await fetch(new URL(path, ORIGIN), {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
      headers: { Accept: path === '/' ? 'text/html' : 'application/json' },
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const value = path === '/' ? await response.text() : await response.json();
    const warnings = validate(value);
    results.push({ name, status: 'PASS', warnings });
  } catch (error) {
    results.push({ name, status: 'FAIL', error: String(error instanceof Error ? error.message : error) });
  }
}

await inspect('Homepage', '/', (html) => {
  if (!html.includes('SportsEdge') || !html.includes('id="root"')) {
    throw new Error('Expected SportsEdge page and React root were not present');
  }
  return [];
});
await inspect('Backend health', '/api/health', (payload) => {
  if (payload?.ok !== true) throw new Error('Health endpoint did not report ok:true');
  const warnings = [];
  if (payload.llmConfigured === false) warnings.push('No LLM configured; chat may not work');
  if (payload.sources?.ledger?.durable === false) warnings.push('Durable ledger storage unavailable');
  const odds = ['oddsApi', 'sportsGameOdds', 'sharpApi'];
  if (odds.every((name) => payload.sources?.[name]?.available === false)) {
    warnings.push('No optional odds provider configured; check sportsbook coverage');
  }
  return warnings;
});
await inspect('Anonymous session', '/api/auth/session', (payload) => {
  if (payload?.ok !== true || payload?.authenticated !== false) {
    throw new Error('Anonymous session endpoint returned unexpected result');
  }
  return [];
});

for (const result of results) {
  console.log(result.status + ' ' + result.name + (result.error ? ': ' + result.error : ''));
  for (const warning of result.warnings || []) console.warn('WARN ' + result.name + ': ' + warning);
}
if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
