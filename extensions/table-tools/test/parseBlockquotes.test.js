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
assert.strictEqual(quotes[1].text, "Today one AI, tomorrow another. The SOP didn't change.");
assert.strictEqual(quotes[1].startLine, 6);
assert.strictEqual(quotes[1].endLine, 7);

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

console.log('parseBlockquotes tests passed');
