import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTag, extractTags, normalize, deriveWorkKey } from './classifier.js';

test('classifyTag: group tags', () => {
  assert.equal(classifyTag('2011 Remaster'), 'group');
  assert.equal(classifyTag('Remastered'), 'group');
  assert.equal(classifyTag('Remastered 2019'), 'group');
  assert.equal(classifyTag('Radio Edit'), 'group');
  assert.equal(classifyTag('Single Version'), 'group');
});

test('classifyTag: separate tags', () => {
  assert.equal(classifyTag('Live'), 'separate');
  assert.equal(classifyTag('Live at Wembley'), 'separate');
  assert.equal(classifyTag('Remix'), 'separate');
  assert.equal(classifyTag('Acme Remix'), 'separate');
  assert.equal(classifyTag('Sped Up'), 'separate');
  assert.equal(classifyTag('Slowed + Reverb'), 'separate');
  assert.equal(classifyTag('feat. Drake'), 'separate');
  assert.equal(classifyTag('ft. Drake'), 'separate');
});

test('classifyTag: unknown tags', () => {
  assert.equal(classifyTag('Roles Reversed'), 'unknown');
  assert.equal(classifyTag('Bonus'), 'unknown');
  assert.equal(classifyTag('Acoustic'), 'unknown'); // deliberately not in vocab
});

test('extractTags: parenthetical', () => {
  assert.deepEqual(extractTags('Hollow (Live)'), { base: 'Hollow', tags: ['Live'] });
  assert.deepEqual(extractTags('Song (Live) [2011 Remaster]'), {
    base: 'Song',
    tags: ['Live', '2011 Remaster'],
  });
});

test('extractTags: dash style only peels known tags', () => {
  assert.deepEqual(extractTags('Song - Live'), { base: 'Song', tags: ['Live'] });
  assert.deepEqual(extractTags('Song - 2011 Remaster'), { base: 'Song', tags: ['2011 Remaster'] });
  // Unknown trailing dash segment is NOT treated as a tag — title is preserved.
  assert.deepEqual(extractTags('9 to 5 - Theme'), { base: '9 to 5 - Theme', tags: [] });
});

test('extractTags: a real-title parenthetical stays as a tag but is classified unknown', () => {
  // "(Roles Reversed)" gets extracted as a tag, but classifyTag marks it
  // unknown, so deriveWorkKey keeps it (separate). Manual override can fix it.
  const { base, tags } = extractTags('Traitor (Roles Reversed)');
  assert.equal(base, 'Traitor');
  assert.deepEqual(tags, ['Roles Reversed']);
});

test('normalize', () => {
  assert.equal(normalize('  Héllo,  World! '), 'hello world');
  assert.equal(normalize('Song (feat. X)'), 'song feat x');
});

test('deriveWorkKey: group tags collapse to base', () => {
  const original = deriveWorkKey('Bottom Of Your Boots', 'Ella Langley');
  const radioEdit = deriveWorkKey('Bottom Of Your Boots - Radio Edit', 'Ella Langley');
  const remaster = deriveWorkKey('Bottom Of Your Boots (2011 Remaster)', 'Ella Langley');
  assert.equal(original, radioEdit, 'radio edit should group with original');
  assert.equal(original, remaster, 'remaster should group with original');
});

test('deriveWorkKey: separate tags stay distinct', () => {
  const original = deriveWorkKey('Bottom Of Your Boots', 'Ella Langley');
  const live = deriveWorkKey('Bottom Of Your Boots (Live)', 'Ella Langley');
  const remix = deriveWorkKey('Bottom Of Your Boots (Acme Remix)', 'Ella Langley');
  assert.notEqual(original, live, 'live should be separate');
  assert.notEqual(original, remix, 'remix should be separate');
});

test('deriveWorkKey: precedence — split beats group (live remaster stays separate)', () => {
  const original = deriveWorkKey('Song', 'Artist');
  const liveRemaster = deriveWorkKey('Song (Live) [2011 Remaster]', 'Artist');
  assert.notEqual(original, liveRemaster, 'a live remaster must remain separate');
});

test('deriveWorkKey: unknown tags stay separate', () => {
  const original = deriveWorkKey('Traitor', 'Megan Moroney');
  const rolesReversed = deriveWorkKey('Traitor (Roles Reversed)', 'Megan Moroney');
  assert.notEqual(original, rolesReversed, 'unknown tag should keep it separate by default');
});

test('deriveWorkKey: same song different casing/punctuation groups', () => {
  const a = deriveWorkKey('hate that i made you love me', 'Ariana Grande');
  const b = deriveWorkKey('Hate That I Made You Love Me!', 'ariana grande');
  assert.equal(a, b, 'casing/punctuation differences should not split a work');
});
