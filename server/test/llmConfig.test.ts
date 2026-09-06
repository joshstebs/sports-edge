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

// Free-first chain: Groq gpt-oss is primary; Gemini is opt-in only.
test('LLM configuration creates a free-first provider chain', () => {
  withKeys(KEY_NAMES, () => {
    delete process.env.SPORTSEDGE_ALLOW_GEMINI_FALLBACK;
    const cfg = llmConfig();
    assert.equal(cfg.provider, 'groq');
    assert.equal(cfg.model, 'openai/gpt-oss-120b');
    assert.equal(cfg.fallback?.provider, 'opencode-zen');
    assert.equal(cfg.fallback?.fallback?.provider, 'opencode-go');
    assert.equal(cfg.fallback?.fallback?.fallback?.provider, 'openrouter');
    assert.equal(cfg.fallback?.fallback?.fallback?.fallback?.provider, 'openai');
    assert.equal(cfg.fallback?.fallback?.fallback?.fallback?.fallback, undefined);
  });
  withKeys(['GEMINI_API_KEY'], () => {
    delete process.env.SPORTSEDGE_ALLOW_GEMINI_FALLBACK;
    const cfg = llmConfig();
    assert.equal(cfg.configured, false);
    assert.equal(cfg.provider, 'none');
  });
  withKeys(['GEMINI_API_KEY', 'GROQ_API_KEY'], () => {
    process.env.SPORTSEDGE_ALLOW_GEMINI_FALLBACK = 'true';
    const cfg = llmConfig();
    assert.equal(cfg.provider, 'groq');
    assert.equal(cfg.fallback?.provider, 'gemini');
    delete process.env.SPORTSEDGE_ALLOW_GEMINI_FALLBACK;
  });
  withKeys(['OPENAI_API_KEY'], () => {
    const cfg = llmConfig();
    assert.equal(cfg.provider, 'openai');
    assert.equal(cfg.fallback, undefined);
  });
});
