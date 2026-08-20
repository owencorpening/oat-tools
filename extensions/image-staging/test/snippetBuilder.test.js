'use strict';

const assert = require('assert');
const { buildSnippet } = require('../lib/snippetBuilder');

// New coverage for Draftsman's 'markdown-image' case — the fix for the
// confirmed bug where the 'substack' case renders an HTML <figure> block,
// which can't share syntax with Draftsman's plain ![]() placeholder marker.

function testMarkdownImageProducesPlainMarkdownSyntax() {
  const snippet = buildSnippet({
    target: 'markdown-image',
    imageUrl: 'https://raw.githubusercontent.com/owencorpening/oat-assets/main/water-series/part-09/wetland/wetland.jpg',
    displayName: 'wetlandRestoration'
  });

  assert.strictEqual(
    snippet,
    '![Wetland Restoration](https://raw.githubusercontent.com/owencorpening/oat-assets/main/water-series/part-09/wetland/wetland.jpg)'
  );
  assert.strictEqual(snippet.includes('<figure>'), false);
  assert.strictEqual(snippet.includes('<img'), false);
}

function testMarkdownImageFallsBackToNameWhenNoDisplayName() {
  const snippet = buildSnippet({
    target: 'markdown-image',
    imageUrl: 'https://example.com/x.jpg',
    name: 'someImageName'
  });
  assert.strictEqual(snippet, '![Some Image Name](https://example.com/x.jpg)');
}

function testUnrecognizedTargetStillFallsBackToBareUrl() {
  // Confirms 'markdown-image' didn't accidentally change the pre-existing
  // default-case behavior for other/unknown targets.
  const snippet = buildSnippet({ target: 'raw-github', imageUrl: 'https://example.com/x.jpg' });
  assert.strictEqual(snippet, 'https://example.com/x.jpg');
}

(async () => {
  testMarkdownImageProducesPlainMarkdownSyntax();
  testMarkdownImageFallsBackToNameWhenNoDisplayName();
  testUnrecognizedTargetStillFallsBackToBareUrl();
  console.log('snippetBuilder tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
