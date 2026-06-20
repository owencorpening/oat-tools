'use strict';

const assert = require('assert');
const { findFigures, extractSheetUrl, computeRepairs } = require('../lib/figureRepair');

// ── findFigures ───────────────────────────────────────────────────────────────

const singleFig = [
  '<figure>',
  '  <img src="a.png">',
  '  <figcaption>Figure 1 — Something</figcaption>',
  '</figure>',
];
const found = findFigures(singleFig);
assert.strictEqual(found.length, 1);
assert.strictEqual(found[0].startIdx, 0);
assert.strictEqual(found[0].captionLineIdx, 2);

assert.strictEqual(findFigures(['just text', 'no figures here']).length, 0);

const twoFigs = [
  '<figure>',
  '  <figcaption>Figure 1 — First</figcaption>',
  '</figure>',
  '',
  '<figure>',
  '  <figcaption>Figure 2 — Second</figcaption>',
  '</figure>',
];
assert.strictEqual(findFigures(twoFigs).length, 2);
assert.strictEqual(findFigures(twoFigs)[1].startIdx, 4);

// figure with no figcaption within lookahead is skipped
const noCaption = ['<figure>', '  <img src="x.png">', '</figure>'];
assert.strictEqual(findFigures(noCaption).length, 0);

// ── extractSheetUrl ───────────────────────────────────────────────────────────

assert.strictEqual(
  extractSheetUrl('<a href="https://docs.google.com/spreadsheets/d/abc">View full data table</a>'),
  'https://docs.google.com/spreadsheets/d/abc'
);
assert.strictEqual(extractSheetUrl('no link here'), null);

// ── computeRepairs ────────────────────────────────────────────────────────────

// Renumbers an out-of-order figure
const wrongNum = [
  '<figure>',
  '  <img src="a.png">',
  '  <figcaption>Figure 3 — Some caption</figcaption>',
  '</figure>',
];
const r1 = computeRepairs(wrongNum);
assert.strictEqual(r1.length, 1);
assert.strictEqual(r1[0].lineIdx, 2);
assert.ok(r1[0].newLine.includes('Figure 1 — Some caption'));

// Already correct number produces no repair
const alreadyCorrect = [
  '<figure>',
  '  <figcaption>Figure 1 — Already correct</figcaption>',
  '</figure>',
];
assert.strictEqual(computeRepairs(alreadyCorrect).length, 0);

// Normalises colon separator to em dash
const colonSep = [
  '<figure>',
  '  <figcaption>Figure 1: Old style caption</figcaption>',
  '</figure>',
];
const r2 = computeRepairs(colonSep);
assert.strictEqual(r2.length, 1);
assert.ok(r2[0].newLine.includes('Figure 1 — Old style caption'));

// Table figure with bare "View full data" link gets a number
const tableCaption = [
  '<figure>',
  '  <img src="table.png">',
  '  <figcaption><a href="https://docs.google.com/spreadsheets/d/xyz">View full data table</a></figcaption>',
  '</figure>',
];
const r3 = computeRepairs(tableCaption);
assert.strictEqual(r3.length, 1);
assert.ok(r3[0].newLine.includes('Figure 1 — [Add description]'));
assert.ok(r3[0].newLine.includes('https://docs.google.com/spreadsheets/d/xyz'));

// Two figures get sequential numbers
const twoMixed = [
  '<figure>',
  '  <figcaption>Figure 5 — First one</figcaption>',
  '</figure>',
  '',
  '<figure>',
  '  <figcaption>Figure 5 — Second one</figcaption>',
  '</figure>',
];
const r4 = computeRepairs(twoMixed);
assert.strictEqual(r4.length, 2);
assert.ok(r4[0].newLine.includes('Figure 1 — First one'));
assert.ok(r4[1].newLine.includes('Figure 2 — Second one'));

// Figure without recognisable caption pattern is skipped (no repair, still counted)
// The unknown figure occupies slot 1, so the next figure must become Figure 2
const unknownCaption = [
  '<figure>',
  '  <figcaption>Some custom text with no figure number</figcaption>',
  '</figure>',
  '',
  '<figure>',
  '  <figcaption>Figure 9 — Should become Figure 2</figcaption>',
  '</figure>',
];
const r5 = computeRepairs(unknownCaption);
assert.strictEqual(r5.length, 1);
assert.ok(r5[0].newLine.includes('Figure 2 — Should become Figure 2'));

console.log('repairFigures tests passed');
