import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levenshtein, similarityRatio, scoreMatch } from './similarity.js';

test('levenshtein: basic distances', () => {
  assert.equal(levenshtein('', ''), 0);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('abc', 'abd'), 1);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('abc', ''), 3);
});

test('similarityRatio: identical and normalized', () => {
  assert.equal(similarityRatio('Hollow', 'Hollow'), 1);
  // Casing/punctuation normalized away -> still identical.
  assert.equal(similarityRatio('Hollow!', 'hollow'), 1);
  assert.equal(similarityRatio('', ''), 1);
});

test('similarityRatio: close but not identical is high', () => {
  const r = similarityRatio('Bottom Of Your Boots', 'Bottom of your Boot');
  assert.ok(r > 0.9 && r < 1, `expected high-but-not-1, got ${r}`);
});

test('similarityRatio: different strings are low', () => {
  assert.ok(similarityRatio('Hollow', 'Perfume') < 0.5);
});

test('scoreMatch: identical title+artist scores ~1 and duration ok', () => {
  const r = scoreMatch(
    { title: 'Hollow', artist: 'Tori Kelly', durationMs: 200_000 },
    { title: 'Hollow', artist: 'Tori Kelly', durationMs: 200_000 },
    10_000,
  );
  assert.equal(r.score, 1);
  assert.equal(r.durationOk, true);
});

test('scoreMatch: group tag stripped so radio edit matches original', () => {
  const r = scoreMatch(
    { title: 'Hollow - Radio Edit', artist: 'Tori Kelly', durationMs: null },
    { title: 'Hollow', artist: 'Tori Kelly', durationMs: null },
    10_000,
  );
  assert.equal(r.score, 1, 'group tag should be stripped before comparing');
});

test('scoreMatch: separate tag kept so live does NOT match original', () => {
  const r = scoreMatch(
    { title: 'Hollow (Live)', artist: 'Tori Kelly', durationMs: null },
    { title: 'Hollow', artist: 'Tori Kelly', durationMs: null },
    10_000,
  );
  assert.ok(r.score < 0.92, `live should not reach auto-match, got ${r.score}`);
});

test('scoreMatch: duration beyond tolerance flips durationOk false', () => {
  const r = scoreMatch(
    { title: 'Hollow', artist: 'Tori Kelly', durationMs: 200_000 },
    { title: 'Hollow', artist: 'Tori Kelly', durationMs: 215_000 }, // 15s apart
    10_000,
  );
  assert.equal(r.durationOk, false);
});

test('scoreMatch: unknown duration does not penalize', () => {
  const r = scoreMatch(
    { title: 'Hollow', artist: 'Tori Kelly', durationMs: null },
    { title: 'Hollow', artist: 'Tori Kelly', durationMs: 200_000 },
    10_000,
  );
  assert.equal(r.durationOk, true);
});

test('scoreMatch: three threshold bands (auto / review / new)', () => {
  const cand = { title: 'Hollow', artist: 'Tori Kelly', durationMs: 200_000 };
  const exact = scoreMatch({ title: 'Hollow', artist: 'Tori Kelly', durationMs: 200_000 }, cand, 10_000);
  const border = scoreMatch({ title: 'Hollow', artist: 'Tori K', durationMs: 200_000 }, cand, 10_000);
  const far = scoreMatch({ title: 'Completely Different', artist: 'Another', durationMs: 180_000 }, cand, 10_000);

  assert.ok(exact.score >= 0.92, `exact should auto-match, got ${exact.score}`);
  assert.ok(border.score >= 0.8 && border.score < 0.92, `borderline should be in review band, got ${border.score}`);
  assert.ok(far.score < 0.8, `far should create new, got ${far.score}`);
});
