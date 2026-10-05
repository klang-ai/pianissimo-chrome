import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argmax, normalizeText, parseVocabulary, tokensToWords } from '../../src/core/text.ts';
import { audioChunks, validateAudio } from '../../src/core/audio.ts';
import { exportTranscript } from '../../src/core/export.ts';
import { assetsFor, getModel, MODELS, downloadMegabytes } from '../../src/core/model.ts';
import type { Transcript } from '../../src/core/types.ts';

test('Swedish word boundaries and punctuation survive token decoding', () => {
  const vocab = parseVocabulary('▁Det 0\n▁är 1\n▁åtta 2\n. 3\n<blk> 4');
  const words = tokensToWords(
    [
      { id: 0, frame: 0, duration: 1 },
      { id: 1, frame: 1, duration: 1 },
      { id: 2, frame: 2, duration: 1 },
      { id: 3, frame: 3, duration: 0 },
    ],
    vocab,
    1,
  );
  assert.equal(words.map((w) => w.text).join(' '), 'Det är åtta.');
  assert.equal(normalizeText('▁Örebro ▁är ▁vackert .'), 'Örebro är vackert.');
  assert.equal(words.at(-1)?.end, 0.32);
});
test('corrupt vocabularies fail closed', () => {
  for (const text of ['a 0\na 0\n<blk> 1', 'a 1\n<blk> 2', 'a 0', 'bad', 'a 999999'])
    assert.throws(() => parseVocabulary(text));
});
test('greedy argmax, tie-breaking and invalid logits', () => {
  assert.equal(argmax([1, 3, 3, 2]), 1);
  assert.equal(argmax([100, 0, 2, 3], 1), 2);
  assert.throws(() => argmax([NaN]));
  assert.throws(() => argmax([]));
});
test('audio validation rejects unsafe inputs', () => {
  assert.throws(() => validateAudio(new Float32Array(0)));
  assert.throws(() => validateAudio(new Float32Array(1600).fill(NaN)));
  assert.throws(() => validateAudio(new Float32Array(1600).fill(2)));
  assert.doesNotThrow(() => validateAudio(new Float32Array(1600)));
});
test('long audio ownership covers each sample exactly once with overlapping context', () => {
  for (const seconds of [1, 30, 31, 60, 61, 1800]) {
    const chunks = [...audioChunks(seconds * 16000)];
    assert.equal(chunks[0]?.keepStart, 0);
    assert.equal(chunks.at(-1)?.keepEnd, seconds * 16000);
    chunks.forEach((chunk, i) => {
      assert.ok(chunk.start <= chunk.keepStart && chunk.end >= chunk.keepEnd);
      assert.ok(chunk.end - chunk.start <= 34 * 16000);
      if (i) assert.equal(chunks[i - 1]?.keepEnd, chunk.keepStart);
    });
  }
});
test('subtitle export formats hours and sanitizes cue arrows', () => {
  const transcript: Transcript = {
    text: 'Hej →',
    words: [{ text: 'Hej -->', start: 3600.125, end: 3601.25 }],
    duration: 3602,
    processingSeconds: 1,
    model: 'KlangAI/pianissimo-sv-onnx',
    revision: 'test',
    quantization: 'int8',
  };
  assert.equal(exportTranscript(transcript, 'srt'), '1\n01:00:00,125 --> 01:00:01,250\nHej →\n');
  assert.match(exportTranscript(transcript, 'vtt'), /^WEBVTT\n\n01:00:00.125/u);
  assert.equal(JSON.parse(exportTranscript(transcript, 'json')).words[0].start, 3600.125);
});
test('quantization variants remain pinned to known sizes and SHA256', () => {
  for (const quantization of ['int8', 'int4'] as const)
    for (const asset of assetsFor(quantization)) {
      assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
      assert.ok(asset.bytes > 0);
    }
});
test('WebVTT preserves literal markup and entity characters as cue text', () => {
  const text = '<b> &amp; > -->';
  const transcript: Transcript = {
    text,
    words: [{ text, start: 0, end: 1 }],
    duration: 1,
    processingSeconds: 0,
    model: 'test',
    revision: 'test',
    quantization: 'int8',
  };
  assert.equal(
    exportTranscript(transcript, 'vtt'),
    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n&lt;b&gt; &amp;amp; &gt; →\n',
  );
  assert.equal(exportTranscript(transcript, 'txt'), `${text}\n`);
});

test('models isolate identical filenames and reject unavailable variants', () => {
  const swedish = getModel(),
    multilingual = getModel('parakeet-tdt-v3');
  assert.notEqual(swedish.cacheDirectory, multilingual.cacheDirectory);
  assert.notEqual(swedish.assets('int8')[0]!.sha256, multilingual.assets('int8')[0]!.sha256);
  assert.equal(multilingual.language, undefined);
  assert.throws(() => multilingual.assets('int4'), /INT8/u);
  assert.equal(downloadMegabytes(swedish, 'int8'), 661);
  assert.equal(downloadMegabytes(swedish, 'int4'), 515);
  assert.equal(downloadMegabytes(multilingual, 'int8'), 671);
  for (const model of MODELS)
    for (const quantization of model.quantizations)
      for (const asset of model.assets(quantization)) {
        assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
        assert.ok(asset.bytes > 0);
      }
});
