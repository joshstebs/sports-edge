import assert from 'node:assert/strict';
import test from 'node:test';
import { llmConfig, runAgent } from '../src/llm/chatClient.js';

test('OpenCode sends high reasoning, preserves private tool context, and emits only the answer', async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENCODE_ZEN_API_KEY;
  process.env.OPENCODE_ZEN_API_KEY = 'local-provider-fixture';
  let calls = 0;
  const deltas: string[] = [];
  globalThis.fetch = (async (input, options) => {
    calls++;
    assert.equal(String(input), 'https://opencode.ai/zen/v1/chat/completions');
    const headers = options!.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer local-provider-fixture');
    assert.match(headers['User-Agent'], /SportsEdge/);
    const body = JSON.parse(String(options!.body));
    assert.equal(body.reasoning_effort, 'high');
    assert.deepEqual(body.thinking, { type: 'enabled' });
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.temperature, undefined);
    if (calls === 2) {
      const assistant = body.messages.find((m: any) => m.role === 'assistant');
      assert.equal(assistant.reasoning_content, 'private fixture context');
      assert.equal(assistant.tool_calls[0].id, 'fixture-call');
      assert.equal(body.messages.find((m: any) => m.role === 'tool').tool_call_id, 'fixture-call');
      assert.equal(body.tools, undefined);
    }
    const deltas = calls === 1 ? [
      { reasoning_content: 'private fixture ' }, { reasoning_content: 'context' },
      { tool_calls: [{ index: 0, id: 'fixture-call', type: 'function', function: { name: 'fixture_tool', arguments: '{}' } }] },
    ] : [{ content: 'Final explanation.' }];
    return new Response(deltas.map((delta) => 'data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n').join('') + 'data: [DONE]\n\n');
  }) as typeof fetch;
  try {
    const result = await runAgent(llmConfig(), [{ role: 'user', content: 'Explain this statistic using fixture_tool.' }],
      [{ type: 'function', function: { name: 'fixture_tool', description: 'Fixture', parameters: { type: 'object', properties: {} } } }],
      { onDelta: (text) => deltas.push(text) });
    assert.equal(calls, 2);
    assert.equal(result.content, 'Final explanation.');
    assert.equal(deltas.join(''), 'Final explanation.');
    assert.equal(result.modelUsed, 'deepseek-v4.1-flash');
    assert.equal((result as any).reasoningContent, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENCODE_ZEN_API_KEY;
    else process.env.OPENCODE_ZEN_API_KEY = previousKey;
  }
});
