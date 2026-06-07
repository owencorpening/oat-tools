'use strict';

const assert = require('assert');
const { placeAsset, snippetFormatForTarget } = require('../lib/imagePipeline');

async function testPlaceAssetSuccess() {
  const calls = [];
  const ledger = fakeLedger(calls);
  const repo = fakeRepo(calls);

  const result = await placeAsset({
    db: {},
    sagaId: 'saga-1',
    repoPath: '/tmp/oat-assets',
    asset: {
      id: 'asset-1',
      slug: 'river-map',
      displayName: 'RiverMap',
      sourceUrl: 'https://example.com/river-map.jpg',
      photographer: 'Owen',
      license: 'OAT',
      intakeSection: 'water-series/part-09'
    },
    placement: {
      id: 'placement-1',
      target: 'substack',
      figureNumber: '2',
      contentDraftId: 'draft-1'
    },
    ledger,
    repo,
    writeSnippet: async ({ snippetFormat }) => calls.push(['writeSnippet', snippetFormat])
  });

  assert.strictEqual(result.snippetFormat, 'html-figure');
  assert.strictEqual(result.placedAsset.relPath, 'water-series/part-09/river-map');
  assert(result.snippet.includes('Figure 2'));
  assert(calls.some(call => call[0] === 'assetPublication' && call[1] === 'water-series/part-09/river-map'));
  assert(calls.some(call => call[0] === 'placementSnippet' && call[1] === 'html-figure'));
  assert.deepStrictEqual(calls.at(-1), ['sagaStep', 7, 'succeeded']);
}

async function testFailureMarksSagaFailed() {
  const calls = [];
  const ledger = fakeLedger(calls);
  const repo = fakeRepo(calls, { failDownload: true });

  await assert.rejects(
    () => placeAsset({
      db: {},
      sagaId: 'saga-2',
      repoPath: '/tmp/oat-assets',
      asset: {
        id: 'asset-2',
        slug: 'bad-download',
        displayName: 'BadDownload',
        sourceUrl: 'https://example.com/missing.jpg',
        photographer: 'Owen',
        license: 'OAT',
        intakeSection: 'water-series/part-09'
      },
      placement: {
        id: 'placement-2',
        target: 'carousel',
        contentDraftId: 'draft-1'
      },
      ledger,
      repo
    }),
    /download failed/
  );

  assert(calls.some(call => call[0] === 'failed' && call[1] === 'download failed'));
}

function testSnippetFormatForTarget() {
  assert.strictEqual(snippetFormatForTarget('substack'), 'html-figure');
  assert.strictEqual(snippetFormatForTarget('carousel'), 'marp-image');
  assert.strictEqual(snippetFormatForTarget('linkedin-post'), 'linkedin-handoff-text');
  assert.strictEqual(snippetFormatForTarget('unknown'), 'raw-url');
}

function fakeLedger(calls) {
  return {
    markSagaStep: async (db, sagaId, updates) => {
      calls.push(['sagaStep', updates.currentStep, updates.status]);
    },
    markAssetPublishing: async () => calls.push(['assetPublishing']),
    markPlacementPublishing: async () => calls.push(['placementPublishing']),
    updateAssetPublication: async (db, updates) => {
      calls.push(['assetPublication', updates.assetPath, updates.rawAssetUrl]);
    },
    updatePlacementSnippet: async (db, updates) => {
      calls.push(['placementSnippet', updates.snippetFormat, updates.snippet]);
    },
    markPlaced: async (db, updates) => {
      calls.push(['placed', updates.placementId, updates.assetId, updates.publishedUrl]);
    },
    markFailed: async (db, updates) => {
      calls.push(['failed', updates.error.message, updates.resolution]);
    }
  };
}

function fakeRepo(calls, options = {}) {
  return {
    createPlacedAsset: ({ series, partDir, slug }) => ({
      downloadSrc: 'https://example.com/river-map.jpg',
      imagePath: `/tmp/${slug}.jpg`,
      relPath: `${series}/${partDir}/${slug}`,
      imageUrl: `https://raw.example.com/${series}/${partDir}/${slug}/${slug}.jpg`
    }),
    downloadAsset: async () => {
      calls.push(['download']);
      if (options.failDownload) throw new Error('download failed');
    },
    gitPushAsset: async () => calls.push(['gitPush'])
  };
}

(async () => {
  await testPlaceAssetSuccess();
  await testFailureMarksSagaFailed();
  testSnippetFormatForTarget();
  console.log('imagePipeline tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
