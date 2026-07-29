'use strict';

const assert = require('assert');
const { findQuoteRange } = require('../lib/findQuoteRange');

function testExactMatch() {
  const text = 'Intro paragraph.\n\nIt is not activism. It is engineering.\n\nMore text.';
  const range = findQuoteRange(text, 'It is not activism. It is engineering.', 0);
  assert.ok(range);
  assert.strictEqual(text.slice(range.start, range.end), 'It is not activism. It is engineering.');
}

function testRespectsFromOffset() {
  const text = 'It is not activism. Later on, it is not activism, again.';
  const range = findQuoteRange(text, 'it is not activism', 10);
  assert.ok(range);
  assert.ok(range.start > 10);
  assert.strictEqual(text.slice(range.start, range.end), 'it is not activism');
}

function testWhitespaceTolerantMatch() {
  const text = 'Header\n\nThe pipe   moves\nwater, not opinions.\n\nFooter';
  const range = findQuoteRange(text, 'The pipe moves water, not opinions.', 0);
  assert.ok(range);
  assert.strictEqual(text.slice(range.start, range.end), 'The pipe   moves\nwater, not opinions.');
}

function testNoMatch() {
  assert.strictEqual(findQuoteRange('Nothing relevant here.', 'not present anywhere', 0), null);
}

function testNullOrEmptyQuote() {
  assert.strictEqual(findQuoteRange('some text', null, 0), null);
  assert.strictEqual(findQuoteRange('some text', '', 0), null);
}

function testEscapesRegexSpecialChars() {
  const text = 'Cost overruns hit 3.5x (not 2x) in year one.';
  const range = findQuoteRange(text, 'Cost overruns hit 3.5x (not 2x) in year one.', 0);
  assert.ok(range);
  assert.strictEqual(text.slice(range.start, range.end), 'Cost overruns hit 3.5x (not 2x) in year one.');
}

testExactMatch();
testRespectsFromOffset();
testWhitespaceTolerantMatch();
testNoMatch();
testNullOrEmptyQuote();
testEscapesRegexSpecialChars();
console.log('findQuoteRange tests passed');
