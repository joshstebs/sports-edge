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

test('configured independent providers form an ordered fallback chain', () => {
  withKeys(KEY_NAMES, () => {
    const cfg = llmConfig();
    assert.equal(cfg.provider, 'groq');
    assert.equal(cfg.model, 'openai/gpt-oss-120b');
    assert.equal(cfg.fallback?.provider, 'gemini');
    assert.equal(cfg.fallback?.fallback?.provider, 'openrouter');
    assert.equal(cfg.fallback?.fallback?.fallback?.provider, 'opencode-zen');
    assert.equal(cfg.fallback?.fallback?.fallback?.reasoningEffort, 'high');
    assert.equal(cfg.fallback?.fallback?.fallback?.fallback, undefined);
  });
});

test('Zen alone is valid but cannot suppress independent providers', () => {
  withKeys(['OPENCODE_ZEN_API_KEY'], () => {
    assert.equal(llmConfig().provider, 'opencode-zen');
    assert.equal(llmConfig().fallback, undefined);
  });
  withKeys(['GROQ_API_KEY', 'OPENCODE_ZEN_API_KEY'], () => {
    assert.equal(llmConfig().provider, 'groq');
    assert.equal(llmConfig().fallback?.provider, 'opencode-zen');
  });
});

test('provider fallback uses only actually configured credentials', () => {
  withKeys(['GROQ_API_KEY', 'GEMINI_API_KEY'], () => {
    const cfg = llmConfig();
    assert.equal(cfg.provider, 'groq');
    assert.equal(cfg.fallback?.provider, 'gemini');
    assert.equal(cfg.fallback?.fallback, undefined);
  });
  withKeys(['GEMINI_API_KEY'], () => assert.equal(llmConfig().provider, 'gemini'));
  withKeys(['OPENROUTER_API_KEY'], () => assert.equal(llmConfig().provider, 'openrouter'));
  withKeys(['OPENAI_API_KEY', 'OPENCODE_GO_API_KEY'], () => assert.equal(llmConfig().configured, false));
});
