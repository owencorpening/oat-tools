'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Some lib files are hand-duplicated across extensions/*/lib because each
// extension is vsce-packaged from its own directory and can't share a
// cross-extension require (see the comment atop each file below). This test
// catches the case where one copy gets fixed and the other doesn't.
const DUPLICATED_PAIRS = [
  [
    'extensions/table-tools/lib/findQuoteRange.js',
    'extensions/image-staging/lib/findQuoteRange.js'
  ]
];

for (const [a, b] of DUPLICATED_PAIRS) {
  const contentA = fs.readFileSync(path.join(__dirname, '..', a), 'utf8');
  const contentB = fs.readFileSync(path.join(__dirname, '..', b), 'utf8');
  assert.strictEqual(contentA, contentB, `${a} and ${b} have drifted apart — sync them`);
}

console.log('sharedLibsInSync tests passed');
