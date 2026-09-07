import assert from 'node:assert/strict';
import test from 'node:test';
import { llmConfig } from '../src/llm/chatClient.js';

const KEY_NAMES = [
  'OPENROUTER_API_KEY',
  'OPENCODE_GO_API_KEY',
  'OPENCODE_ZEN_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
] as const;

type KeyName = (typeof KEY_NAMES)[number];

function withKeys(enabled: readonly KeyName[], run: () => void) {
  const previous = Object.fromEntries(KEY_NAMES.map((name) => [name, process.env[name]]));
  try {
    for (const name of KEY_NAMES) {
      if (enabled.includes(name)) process.env[name] = `test-${name.toLowerCase()}`;
      else delete process.env[name];
    }
    run();
  } finally {
    for (const name of KEY_NAMES) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test('only verified providers are used despite retired credentials being present', () => {
  withKeys(KEY_NAMES, () => {
    const cfg = llmConfig();
    assert.equal(cfg.provider, 'groq');
    assert.equal(cfg.model, 'openai/gpt-oss-120b');
    assert.equal(cfg.fallback?.provider, 'gemini');
    assert.equal(cfg.fallback?.fallback, undefined);
  });
  withKeys(['GEMINI_API_KEY'], () => assert.equal(llmConfig().provider, 'gemini'));
  withKeys(['OPENAI_API_KEY', 'OPENCODE_GO_API_KEY', 'OPENROUTER_API_KEY'], () => assert.equal(llmConfig().configured, false));
});
