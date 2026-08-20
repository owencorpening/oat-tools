'use strict';

const assert = require('assert');
const {
  PLACEHOLDER_REL_PATH,
  buildPlaceholderLine,
  parsePlaceholderLine,
  parseImageLine,
  escapeAltText,
  truncateContext
} = require('../lib/draftsmanMarker');

function testBuildAndParsePlaceholderLineRoundTrip() {
  const line = buildPlaceholderLine('a paragraph about wetland restoration');
  assert.strictEqual(line, `![TODO:IMG "a paragraph about wetland restoration"](${PLACEHOLDER_REL_PATH})`);

  const parsed = parsePlaceholderLine(line);
  assert.deepStrictEqual(parsed, { context: 'a paragraph about wetland restoration' });
}

function testParsePlaceholderLineRejectsMalformedLines() {
  assert.strictEqual(parsePlaceholderLine('not an image line at all'), null);
  assert.strictEqual(parsePlaceholderLine('![some alt](some-other-image.png)'), null);
  assert.strictEqual(parsePlaceholderLine('![TODO:IMG "context"](wrong/path.png)'), null);
}

function testEscapeAltTextStripsQuotesAndNewlines() {
  assert.strictEqual(escapeAltText('has "quotes" inside'), "has 'quotes' inside");
  assert.strictEqual(escapeAltText('line one\nline two\r\nline three'), 'line one line two line three');
  assert.strictEqual(escapeAltText('  extra   spaces  '), 'extra spaces');
  assert.strictEqual(escapeAltText(null), '');
  assert.strictEqual(escapeAltText(undefined), '');
}

function testBuildPlaceholderLineEscapesContext() {
  const line = buildPlaceholderLine('context with "quotes" and\nnewlines');
  assert.strictEqual(line, `![TODO:IMG "context with 'quotes' and newlines"](${PLACEHOLDER_REL_PATH})`);
}

function testTruncateContextCapsLongParagraphs() {
  const long = 'x'.repeat(300);
  const truncated = truncateContext(long, 200);
  assert.strictEqual(truncated.length, 200);
  assert.strictEqual(truncated.endsWith('…'), true);

  const short = 'a short paragraph';
  assert.strictEqual(truncateContext(short, 200), short);
}

function testParseImageLineDetectsPlaceholderVsResolved() {
  const placeholderParsed = parseImageLine(`![TODO:IMG "context"](${PLACEHOLDER_REL_PATH})`);
  assert.deepStrictEqual(placeholderParsed, {
    alt: 'TODO:IMG "context"',
    src: PLACEHOLDER_REL_PATH,
    isPlaceholder: true
  });

  const resolvedParsed = parseImageLine('![Wetland restoration](https://raw.githubusercontent.com/owencorpening/oat-assets/main/water-series/part-09/wetland/wetland.jpg)');
  assert.strictEqual(resolvedParsed.isPlaceholder, false);
  assert.strictEqual(resolvedParsed.alt, 'Wetland restoration');

  assert.strictEqual(parseImageLine('plain text, not an image line'), null);
}

(async () => {
  testBuildAndParsePlaceholderLineRoundTrip();
  testParsePlaceholderLineRejectsMalformedLines();
  testEscapeAltTextStripsQuotesAndNewlines();
  testBuildPlaceholderLineEscapesContext();
  testTruncateContextCapsLongParagraphs();
  testParseImageLineDetectsPlaceholderVsResolved();
  console.log('draftsmanMarker tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
