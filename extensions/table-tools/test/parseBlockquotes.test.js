'use strict';
const assert = require('assert');
const { parseBlockquotes } = require('../lib/parseBlockquotes');

const md = [
  'Before',
  '',
  '> That machinery is now gone.',
  '',
  'Middle',
  '',
  '> Today one AI, tomorrow another.',
  '> The SOP didn\'t change.',
  '',
  'After'
].join('\n');

const quotes = parseBlockquotes(md);
assert.strictEqual(quotes.length, 2);
assert.strictEqual(quotes[0].text, 'That machinery is now gone.');
assert.strictEqual(quotes[0].startLine, 2);
assert.strictEqual(quotes[0].endLine, 2);
assert.strictEqual(quotes[0].skipReason, null);
assert.strictEqual(quotes[1].text, "Today one AI, tomorrow another. The SOP didn't change.");
assert.strictEqual(quotes[1].startLine, 6);
assert.strictEqual(quotes[1].endLine, 7);
assert.strictEqual(quotes[1].skipReason, null);

const emphasized = parseBlockquotes('> **Bold claim** and *italic aside*.');
assert.strictEqual(emphasized.length, 1);
assert.strictEqual(emphasized[0].text, 'Bold claim and italic aside.');

const empty = parseBlockquotes('No blockquotes here.');
assert.strictEqual(empty.length, 0);

const blankMarkerOnly = parseBlockquotes([
  '> First line.',
  '>',
  '> Second line.'
].join('\n'));
assert.strictEqual(blankMarkerOnly.length, 1);
assert.strictEqual(blankMarkerOnly[0].text, 'First line. Second line.');
assert.strictEqual(blankMarkerOnly[0].skipReason, null);

// A blockquote that opens with its own heading reads as a structural
// callout (e.g. an Executive Summary box), not a pullquote — flagged, not
// silently promoted.
const headingCallout = parseBlockquotes([
  '> ### Executive Summary',
  '>',
  '> The corridor pays for itself.'
].join('\n'));
assert.strictEqual(headingCallout.length, 1);
assert.strictEqual(headingCallout[0].skipReason, 'heading');

// Three or more blank-line-separated sub-paragraphs reads as a structural
// block rather than a single continuous quote.
const multiParagraph = parseBlockquotes([
  '> First point.',
  '>',
  '> Second point.',
  '>',
  '> Third point.'
].join('\n'));
assert.strictEqual(multiParagraph.length, 1);
assert.strictEqual(multiParagraph[0].skipReason, 'multi-paragraph');

console.log('parseBlockquotes tests passed');
