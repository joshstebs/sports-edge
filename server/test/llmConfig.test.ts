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

// Chain order (2026-08-30, verified live): OpenCode Go is PRIMARY —
// 'stealth/ox-alpha' OpenRouter was retired and its replacement slugs are
// quota-exhausted (403), so OpenRouter is demoted to fallback. Groq is the
// terminal fallback before the chain ends.
test('LLM configuration creates one ordered, deduplicated provider chain', () => {
  withKeys(KEY_NAMES, () => {
    const cfg = llmConfig();
    assert.equal(cfg.provider, 'opencode-go');
    assert.equal(cfg.fallback?.provider, 'openrouter');
    assert.equal(cfg.fallback?.fallback?.provider, 'opencode-zen');
    assert.equal(cfg.fallback?.fallback?.fallback?.provider, 'gemini');
    assert.equal(cfg.fallback?.fallback?.fallback?.fallback?.provider, 'openai');
    assert.equal(cfg.fallback?.fallback?.fallback?.fallback?.fallback?.provider, 'groq');
    assert.equal(cfg.fallback?.fallback?.fallback?.fallback?.fallback?.fallback, undefined);
  });
  withKeys(['GEMINI_API_KEY', 'OPENAI_API_KEY'], () => {
    const cfg = llmConfig();
    assert.equal(cfg.provider, 'gemini');
    assert.equal(cfg.fallback?.provider, 'openai');
    assert.equal(cfg.fallback?.fallback, undefined);
  });
  withKeys(['OPENROUTER_API_KEY', 'OPENAI_API_KEY'], () => {
    const cfg = llmConfig();
    assert.equal(cfg.provider, 'openrouter');
    assert.equal(cfg.fallback?.provider, 'openai');
    assert.equal(cfg.fallback?.fallback, undefined);
  });
  withKeys(['OPENAI_API_KEY'], () => {
    const cfg = llmConfig();
    assert.equal(cfg.provider, 'openai');
    assert.equal(cfg.fallback, undefined);
  });
});
