// Live probe of every model slug in chatClient.ts's llmConfig() chain.
// Usage: node scripts/probe-llm-chain.mjs
// Reads keys from env (server/.env + ~/.hermes/.env loaded by caller).

const PROBES = [
  { provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1', keyEnv: 'OPENCODE_GO_API_KEY', models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k3'] },
  { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', models: ['meta-llama/llama-3.3-70b-instruct', 'openai/gpt-oss-120b'] },
  { provider: 'opencode-zen', baseUrl: 'https://opencode.ai/zen/v1', keyEnv: 'OPENCODE_ZEN_API_KEY', models: ['deepseek-v4-flash-free', 'hy3-free', 'nemotron-3-ultra-free'] },
  { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', models: ['gemini-3.6-flash'] },
];

const body = JSON.stringify({
  model: 'X', messages: [{ role: 'user', content: 'Reply with the single word: pong' }], temperature: 0, max_tokens: 8,
});

for (const p of PROBES) {
  const key = process.env[p.keyEnv];
  if (!key) { console.log(`${p.provider}: SKIP (no ${p.keyEnv})`); continue; }
  for (const model of p.models) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          // OpenCode requires this header (mandatory 2026-09-06).
          ...(p.provider.startsWith('opencode') ? { 'x-opencode-session': 'sportsedge-probe' } : {}),
        },
        body: body.replace('"X"', JSON.stringify(model)),
        signal: AbortSignal.timeout(25_000),
      });
      const ms = Date.now() - t0;
      const text = await res.text();
      let note = '';
      try {
        const j = JSON.parse(text);
        note = j?.choices?.[0]?.message?.content?.trim().slice(0, 40) ?? (j?.error?.message ?? '').slice(0, 120);
      } catch { note = text.slice(0, 120); }
      console.log(`${p.provider}/${model}: HTTP ${res.status} (${ms}ms) ${res.status === 200 ? 'OK ->' : 'FAIL ->'} ${JSON.stringify(note)}`);
    } catch (e) {
      console.log(`${p.provider}/${model}: THROW ${e.name}: ${String(e.message).slice(0, 120)}`);
    }
  }
}
