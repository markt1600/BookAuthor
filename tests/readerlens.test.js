import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Reader Lens is a standalone engine (zero deps, no app imports) plus a
// distilled data file. These tests lock the guide's verification steps
// (INTEGRATE.md, Step 5) so a wholesale data replacement can't silently break
// the genre lookup, phase detection, scene tagging, or the prompt blocks.
const {
  matchGenre,
  detectPhase,
  sceneTagInstruction,
  parseSceneTags,
  lensBlock,
  rubricBlock,
} = await import('../lib/readerlens.js');
const lenses = JSON.parse(readFileSync(join(process.cwd(), 'data', 'reader-lenses.json'), 'utf8'));

test('the distilled lens data is present and shaped for every genre', () => {
  assert.ok(lenses.version, 'data has a version');
  const keys = Object.keys(lenses.lenses);
  assert.ok(keys.includes('general'), 'a general fallback lens exists');
  for (const k of keys) {
    const l = lenses.lenses[k];
    assert.ok(Array.isArray(l.reward) && l.reward.length, `${k} has reward lines`);
    assert.ok(Array.isArray(l.punish) && l.punish.length, `${k} has punish lines`);
    assert.ok(l.scenes && typeof l.scenes === 'object', `${k} has a scene taxonomy`);
  }
});

test('matchGenre maps free-text labels and guide flags to lens keys (guide 5.2)', () => {
  assert.equal(matchGenre(lenses, 'Psychological thriller'), 'mystery_thriller_crime');
  assert.equal(matchGenre(lenses, 'Literary horror'), 'fantasy_paranormal');
  assert.equal(matchGenre(lenses, 'Something unknown'), 'general');
  // Explicit book settings win over the label.
  assert.equal(matchGenre(lenses, 'Cozy mystery', { erotica: true }), 'erotica');
  assert.equal(matchGenre(lenses, 'Literary fiction', { style: 'burdett' }), 'mystery_thriller_crime');
  assert.equal(matchGenre(lenses, 'Drama', { adult: true, sexual: 3 }), 'erotica');
});

test('lensBlock leads with phase + scene guidance, then genre notes (guide 5.3)', () => {
  const block = lensBlock(lenses, { genre: 'erotica', phase: 'ending', scenes: ['aftermath_intimacy'] });
  assert.ok(block.includes('Approaching the ENDING'), 'carries the ending-phase guidance');
  assert.ok(block.includes('For '), 'carries the tagged-scene guidance');
  // The situational head is kept; the generic tail is what gets clipped.
  assert.ok(block.length <= 2000, 'respects the writer length cap');
  assert.ok(rubricBlock(lenses, 'erotica').length <= 1200, 'rubric respects its cap');
});

test('parseSceneTags reads the planner tag line and falls back to label words', () => {
  const tags = parseSceneTags('WANT: …\nSCENES: slow_burn_tease, first_consummation', lenses, 'erotica');
  assert.deepEqual(tags, ['slow_burn_tease', 'first_consummation']);
  // Only two keys, and only valid ones for the genre.
  assert.ok(parseSceneTags('SCENES: slow_burn_tease, first_consummation, aftermath_intimacy', lenses, 'erotica').length === 2);
  // No tag line: the label words in the plan still surface guidance.
  assert.ok(parseSceneTags('a long argument turns into a first consummation of sorts.', lenses, 'erotica').length >= 1);
});

test('detectPhase honours explicit revision flags and book position', () => {
  assert.equal(detectPhase({ isFirst: true, chapterNum: 9, sections: 40 }), 'opening');
  assert.equal(detectPhase({ isLast: true, chapterNum: 9, sections: 40 }), 'ending');
  assert.equal(detectPhase({ chapterNum: 1, sections: 1 }), 'opening');
  assert.equal(detectPhase({ chapterNum: 4, sections: 10, direction: 'Bring the climax and resolution.' }), 'ending');
  assert.equal(detectPhase({ chapterNum: 4, sections: 10, direction: 'He leaves for the coast.' }), 'middle');
});

test('sceneTagInstruction offers only the genre’s own scene keys', () => {
  const line = sceneTagInstruction(lenses, 'erotica');
  assert.ok(line.includes('SCENES:'), 'tells the planner to end with a SCENES line');
  const genreKeys = Object.keys(lenses.lenses.erotica.scenes);
  assert.ok(genreKeys.length > 0, 'the erotica genre has scene kinds');
  assert.ok(genreKeys.every((k) => line.includes(k)), 'every offered key belongs to the genre');
});
