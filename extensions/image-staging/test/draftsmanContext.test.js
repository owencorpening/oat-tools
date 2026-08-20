'use strict';

const assert = require('assert');
const { captureSurroundingParagraph } = require('../lib/draftsmanContext');

function testCursorMidParagraph() {
  const doc = [
    '# Heading',
    '',
    'This is the first line of a paragraph.',
    'This is the second line of the same paragraph.',
    '',
    'A separate, unrelated paragraph.'
  ].join('\n');

  const result = captureSurroundingParagraph(doc, 2);
  assert.strictEqual(result, 'This is the first line of a paragraph. This is the second line of the same paragraph.');
}

function testCursorOnBlankLinePrefersPrecedingParagraph() {
  const doc = [
    'The preceding paragraph, right before the blank line.',
    '',
    'The following paragraph, after the blank line.'
  ].join('\n');

  // Cursor on the blank line (index 1) should prefer the preceding paragraph.
  const result = captureSurroundingParagraph(doc, 1);
  assert.strictEqual(result, 'The preceding paragraph, right before the blank line.');
}

function testCursorOnBlankLineAtDocStartFallsForward() {
  const doc = [
    '',
    'The only paragraph, right after a leading blank line.'
  ].join('\n');

  const result = captureSurroundingParagraph(doc, 0);
  assert.strictEqual(result, 'The only paragraph, right after a leading blank line.');
}

function testCursorOnHeadingSkipsToNextParagraph() {
  const doc = [
    'Preceding paragraph.',
    '',
    '## A Heading',
    '',
    'The paragraph that follows the heading.'
  ].join('\n');

  const result = captureSurroundingParagraph(doc, 2);
  assert.strictEqual(result, 'Preceding paragraph.');
}

function testCursorOnExistingImageLineSkipsToNearbyParagraph() {
  const doc = [
    'A real paragraph of prose right here.',
    '',
    '![some alt text](some-image.png)',
    '',
    'Another real paragraph.'
  ].join('\n');

  const result = captureSurroundingParagraph(doc, 2);
  assert.strictEqual(result, 'A real paragraph of prose right here.');
}

function testEmptyDocumentReturnsEmptyString() {
  assert.strictEqual(captureSurroundingParagraph('', 0), '');
  assert.strictEqual(captureSurroundingParagraph('\n\n\n', 1), '');
}

function testCursorOutOfBoundsIsClamped() {
  const doc = ['Only one line of text.'].join('\n');
  assert.strictEqual(captureSurroundingParagraph(doc, 999), 'Only one line of text.');
  assert.strictEqual(captureSurroundingParagraph(doc, -5), 'Only one line of text.');
}

function testLongParagraphIsNotTruncatedHere() {
  // Truncation happens downstream in draftsmanMarker.buildPlaceholderLine —
  // captureSurroundingParagraph itself returns the full paragraph text.
  const long = 'word '.repeat(100).trim();
  const result = captureSurroundingParagraph(long, 0);
  assert.strictEqual(result, long);
}

(async () => {
  testCursorMidParagraph();
  testCursorOnBlankLinePrefersPrecedingParagraph();
  testCursorOnBlankLineAtDocStartFallsForward();
  testCursorOnHeadingSkipsToNextParagraph();
  testCursorOnExistingImageLineSkipsToNearbyParagraph();
  testEmptyDocumentReturnsEmptyString();
  testCursorOutOfBoundsIsClamped();
  testLongParagraphIsNotTruncatedHere();
  console.log('draftsmanContext tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
