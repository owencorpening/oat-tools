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
      draftLocation: {
        caption: 'River map. Image by Owen, OAT.'
      },
      contentDraftId: 'draft-1'
    },
    ledger,
    repo,
    writeSnippet: async ({ snippetFormat }) => calls.push(['writeSnippet', snippetFormat])
  });

  assert.strictEqual(result.snippetFormat, 'html-figure');
  assert.strictEqual(result.placedAsset.relPath, 'water-series/part-09/river-map');
  assert(result.snippet.includes('Figure 2'));
  assert(result.snippet.includes('River map. Image by Owen, OAT.'));
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

async function testPlanOnlyDoesNotMarkPlaced() {
  const calls = [];
  const ledger = fakeLedger(calls);
  const repo = fakeRepo(calls);

  await placeAsset({
    db: {},
    sagaId: 'saga-3',
    repoPath: '/tmp/oat-assets',
    asset: {
      id: 'asset-3',
      slug: 'lake-map',
      displayName: 'LakeMap',
      sourceUrl: 'https://example.com/lake-map.jpg',
      photographer: 'Owen',
      license: 'OAT',
      intakeSection: 'water-series/part-09'
    },
    placement: {
      id: 'placement-3',
      target: 'substack',
      figureNumber: '3',
      contentDraftId: 'draft-1'
    },
    ledger,
    repo,
    download: false,
    commit: false,
    writeSnippet: async ({ snippetFormat }) => calls.push(['writeSnippet', snippetFormat])
  });

  assert(!calls.some(call => call[0] === 'download'), 'Should not download the asset');
  assert(!calls.some(call => call[0] === 'gitPush'), 'Should not push to the repo');
  assert(!calls.some(call => call[0] === 'assetPublication'), 'Should not record publication for an unplaced asset');
  assert(!calls.some(call => call[0] === 'placed'), 'Should not mark the placement placed');
  assert(calls.some(call => call[0] === 'placementSnippet'), 'Should still record the planned snippet');
  assert(calls.some(call => call[0] === 'writeSnippet'), 'Should still write the snippet to the draft');
  assert.deepStrictEqual(calls.at(-1), ['sagaStep', 7, 'succeeded']);
}

async function testRecordAssetUseWritesComplianceFilesWhenProvenanceExists() {
  const calls = [];
  const ledger = fakeLedger(calls, {
    recordAssetUse: async (db, { assetId }) => {
      calls.push(['recordAssetUse', assetId]);
      return {
        hasProvenance: true,
        pingPerformed: true,
        pingedAt: '2026-07-21T00:05:00.000Z',
        provider: 'unsplash',
        providerId: 'eOvv6TjnSjc',
        photographer: 'Unsplash Photographer',
        photographerUrl: 'https://unsplash.com/@unsplash-photographer',
        retrievedAt: '2026-07-21T00:00:00.000Z',
        rawProviderRecord: { id: 'eOvv6TjnSjc' },
        // Raw per-provider string (used elsewhere, e.g. captions) — distinct
        // from attributionText below, which is what the pipeline actually
        // writes to attribution_text.txt.
        attribution: 'Image: Misty wetland, by Unsplash Photographer, Source: Unsplash. License: Unsplash License.',
        attributionText: 'Photo by Unsplash Photographer on Unsplash'
      };
    }
  });
  const repo = fakeRepo(calls);

  await placeAsset({
    db: {},
    sagaId: 'saga-4',
    repoPath: '/tmp/oat-assets',
    asset: {
      id: 'asset-4',
      slug: 'misty-wetland',
      displayName: 'Misty wetland at dawn',
      sourceUrl: 'https://unsplash.com/photos/eOvv6TjnSjc',
      photographer: 'Unsplash Photographer',
      license: 'Unsplash License',
      intakeSection: 'water-series/part-09'
    },
    placement: {
      id: 'placement-4',
      target: 'substack',
      figureNumber: '4',
      contentDraftId: 'draft-1'
    },
    ledger,
    repo,
    writeSnippet: async () => {}
  });

  assert.deepStrictEqual(
    calls.find(call => call[0] === 'recordAssetUse'),
    ['recordAssetUse', 'asset-4']
  );
  const complianceCall = calls.find(call => call[0] === 'writeProviderComplianceFiles');
  assert(complianceCall, 'should write compliance files once provenance is available');
  assert.strictEqual(complianceCall[1], '/tmp/asset-dir/misty-wetland');
  assert.strictEqual(complianceCall[2].providerId, 'eOvv6TjnSjc');
  assert.strictEqual(complianceCall[2].pingedAt, '2026-07-21T00:05:00.000Z');
  // The templated string, not the raw per-provider attribution field.
  assert.strictEqual(complianceCall[2].attributionText, 'Photo by Unsplash Photographer on Unsplash');
}

async function testRecordAssetUseSkippedForAssetWithoutProvenance() {
  const calls = [];
  const ledger = fakeLedger(calls, {
    recordAssetUse: async (db, { assetId }) => {
      calls.push(['recordAssetUse', assetId]);
      return { hasProvenance: false, pingPerformed: false };
    }
  });
  const repo = fakeRepo(calls);

  await placeAsset({
    db: {},
    sagaId: 'saga-5',
    repoPath: '/tmp/oat-assets',
    asset: {
      id: 'asset-5',
      slug: 'river-map',
      displayName: 'RiverMap',
      sourceUrl: 'https://example.com/river-map.jpg',
      photographer: 'Owen',
      license: 'OAT',
      intakeSection: 'water-series/part-09'
    },
    placement: {
      id: 'placement-5',
      target: 'substack',
      figureNumber: '5',
      contentDraftId: 'draft-1'
    },
    ledger,
    repo,
    writeSnippet: async () => {}
  });

  assert(calls.some(call => call[0] === 'recordAssetUse'), 'should still call recordAssetUse (worker decides)');
  assert(!calls.some(call => call[0] === 'writeProviderComplianceFiles'), 'should not write compliance files without provenance');
}

async function testRecordAssetUseFailureAbortsPlacement() {
  const calls = [];
  const ledger = fakeLedger(calls, {
    recordAssetUse: async () => {
      throw new Error('Unsplash download_location ping failed');
    }
  });
  const repo = fakeRepo(calls);

  await assert.rejects(
    () => placeAsset({
      db: {},
      sagaId: 'saga-6',
      repoPath: '/tmp/oat-assets',
      asset: {
        id: 'asset-6',
        slug: 'misty-wetland-2',
        displayName: 'Misty wetland at dawn 2',
        sourceUrl: 'https://unsplash.com/photos/abc123',
        photographer: 'Unsplash Photographer',
        license: 'Unsplash License',
        intakeSection: 'water-series/part-09'
      },
      placement: {
        id: 'placement-6',
        target: 'substack',
        contentDraftId: 'draft-1'
      },
      ledger,
      repo,
      writeSnippet: async () => {}
    }),
    /Unsplash download_location ping failed/
  );

  assert(!calls.some(call => call[0] === 'writeProviderComplianceFiles'), 'should never write compliance files on ping failure');
  assert(!calls.some(call => call[0] === 'gitPush'), 'should not proceed to git push after a failed use-time obligation');
  assert(calls.some(call => call[0] === 'failed'), 'should mark the saga failed');
}

function testSnippetFormatForTarget() {
  assert.strictEqual(snippetFormatForTarget('substack'), 'html-figure');
  assert.strictEqual(snippetFormatForTarget('carousel'), 'marp-image');
  assert.strictEqual(snippetFormatForTarget('linkedin-post'), 'linkedin-handoff-text');
  assert.strictEqual(snippetFormatForTarget('unknown'), 'raw-url');
}

function fakeLedger(calls, options = {}) {
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
    },
    ...(options.recordAssetUse ? { recordAssetUse: options.recordAssetUse } : {})
  };
}

function fakeRepo(calls, options = {}) {
  return {
    createPlacedAsset: ({ series, partDir, slug }) => ({
      downloadSrc: 'https://example.com/river-map.jpg',
      assetDir: `/tmp/asset-dir/${slug}`,
      imagePath: `/tmp/${slug}.jpg`,
      relPath: `${series}/${partDir}/${slug}`,
      imageUrl: `https://raw.example.com/${series}/${partDir}/${slug}/${slug}.jpg`
    }),
    downloadAsset: async () => {
      calls.push(['download']);
      if (options.failDownload) throw new Error('download failed');
    },
    gitPushAsset: async () => calls.push(['gitPush']),
    writeProviderComplianceFiles: (assetDir, fields) => {
      calls.push(['writeProviderComplianceFiles', assetDir, fields]);
    }
  };
}

(async () => {
  await testPlaceAssetSuccess();
  await testFailureMarksSagaFailed();
  await testPlanOnlyDoesNotMarkPlaced();
  await testRecordAssetUseWritesComplianceFilesWhenProvenanceExists();
  await testRecordAssetUseSkippedForAssetWithoutProvenance();
  await testRecordAssetUseFailureAbortsPlacement();
  testSnippetFormatForTarget();
  console.log('imagePipeline tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
