import assert from 'node:assert/strict';
import test from 'node:test';
import { llmConfig } from '../src/llm/chatClient.js';

const KEY_NAMES = ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'] as const;

function withKeys(enabled: readonly (typeof KEY_NAMES)[number][], run: () => void) {
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

test('LLM configuration creates one ordered, deduplicated provider chain', () => {
  withKeys(KEY_NAMES, () => {
    const cfg = llmConfig();
    assert.equal(cfg.provider, 'gemini');
    assert.equal(cfg.fallback?.provider, 'openrouter');
    assert.equal(cfg.fallback?.fallback?.provider, 'openai');
    assert.equal(cfg.fallback?.fallback?.fallback, undefined);
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
