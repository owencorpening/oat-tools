'use strict';

const assert = require('assert');
const { findPlaceholderRanges, applyDecorations } = require('../lib/draftsmanDecoration');

class FakeRange {
  constructor(startLine, startChar, endLine, endChar) {
    this.startLine = startLine;
    this.startChar = startChar;
    this.endLine = endLine;
    this.endChar = endChar;
  }
}

const fakeVscode = { Range: FakeRange };

function fakeDocument(text) {
  return { getText: () => text };
}

function testFindsOnlyPlaceholderLines() {
  const text = [
    '# Heading',
    '',
    '![TODO:IMG "context one"](.draftsman/placeholder-image-needed.png)',
    '',
    '![Resolved image alt text](https://raw.githubusercontent.com/owencorpening/oat-assets/main/x/y.jpg)',
    '',
    '![TODO:IMG "context two"](.draftsman/placeholder-image-needed.png)'
  ].join('\n');

  const ranges = findPlaceholderRanges(fakeDocument(text), fakeVscode);
  assert.strictEqual(ranges.length, 2);
  assert.strictEqual(ranges[0].startLine, 2);
  assert.strictEqual(ranges[1].startLine, 6);
}

function testNoPlaceholdersReturnsEmptyArray() {
  const text = '# Heading\n\nJust some prose, no images at all.';
  const ranges = findPlaceholderRanges(fakeDocument(text), fakeVscode);
  assert.deepStrictEqual(ranges, []);
}

function testResolvedImagesAreNotDecorated() {
  const text = '![Resolved](https://raw.githubusercontent.com/owencorpening/oat-assets/main/x/y.jpg)';
  const ranges = findPlaceholderRanges(fakeDocument(text), fakeVscode);
  assert.deepStrictEqual(ranges, []);
}

function testApplyDecorationsCallsSetDecorationsWithFoundRanges() {
  const text = '![TODO:IMG "ctx"](.draftsman/placeholder-image-needed.png)';
  let capturedCall = null;
  const editor = {
    document: fakeDocument(text),
    setDecorations: (decorationType, ranges) => { capturedCall = { decorationType, ranges }; }
  };
  const decorationType = { id: 'fake-decoration-type' };

  applyDecorations(editor, decorationType, fakeVscode);

  assert.strictEqual(capturedCall.decorationType, decorationType);
  assert.strictEqual(capturedCall.ranges.length, 1);
}

function testApplyDecorationsNoOpsWithoutEditor() {
  // Should not throw when there's no active editor.
  applyDecorations(null, {}, fakeVscode);
}

(async () => {
  testFindsOnlyPlaceholderLines();
  testNoPlaceholdersReturnsEmptyArray();
  testResolvedImagesAreNotDecorated();
  testApplyDecorationsCallsSetDecorationsWithFoundRanges();
  testApplyDecorationsNoOpsWithoutEditor();
  console.log('draftsmanDecoration tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
