'use strict';
const assert = require('assert');
const { parseTables } = require('../lib/parseTables');

const md = [
  'Before',
  '',
  '| Region | Value |',
  '| --- | ---: |',
  '| North | 10 |',
  '| South | 12 |',
  '',
  'After'
].join('\n');

const tables = parseTables(md);
assert.strictEqual(tables.length, 1);
assert.deepStrictEqual(tables[0].headers, ['Region', 'Value']);
assert.deepStrictEqual(tables[0].rows, [['North', '10'], ['South', '12']]);
assert.strictEqual(tables[0].startLine, 2);
assert.strictEqual(tables[0].endLine, 5);

const notATable = parseTables('| just a pipe-prefixed note |\n| and another one |');
assert.strictEqual(notATable.length, 0);

const leadingTable = parseTables([
  '| Alpha | Beta |',
  '| --- | ---: |',
  '| One | 1 |',
  '',
  'After'
].join('\n'));
assert.strictEqual(leadingTable.length, 1);
assert.strictEqual(leadingTable[0].startLine, 0);
assert.strictEqual(leadingTable[0].endLine, 2);

console.log('parseTables tests passed');
