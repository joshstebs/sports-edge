import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chunkSpeechText,
  mergeDictationTranscript,
  speechFriendlyText,
} from '../src/lib/speech.ts';

test('dictation appends and then replaces the browser cumulative transcript', () => {
  const interim = mergeDictationTranscript('Check this', '', 'player props');
  assert.equal(interim, 'Check this player props');
  assert.equal(
    mergeDictationTranscript(interim, 'player props', 'player props tonight'),
    'Check this player props tonight',
  );
});

test('dictation preserves manual edits while appending newly recognized words', () => {
  assert.equal(
    mergeDictationTranscript('Check these edited props', 'player props', 'player props tonight'),
    'Check these edited props tonight',
  );
  assert.equal(
    mergeDictationTranscript('Keep my correction', 'old interim', 'revised interim'),
    'Keep my correction',
  );
});

test('speech text is markdown-free and long output is split into bounded chunks', () => {
  assert.equal(speechFriendlyText('**Read** [SportsEdge](https://example.com).'), 'Read SportsEdge.');
  const chunks = chunkSpeechText(
    'First sentence has enough detail to be useful. Second sentence also contains several useful words. Third sentence finishes the response cleanly.',
    55,
  );
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), 'First sentence has enough detail to be useful. Second sentence also contains several useful words. Third sentence finishes the response cleanly.');
  assert.ok(chunks.every((chunk) => chunk.length <= 55));
});
