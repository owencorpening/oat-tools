'use strict';

const assert = require('assert');
const { createLedgerApiClient, createLedgerWriterFromSettings } = require('../lib/ledgerApiClient');

async function testClientPostsExpectedPayloads() {
  const calls = [];
  const client = createLedgerApiClient({
    baseUrl: 'https://ledger.example.com/api/',
    token: 'secret',
    request: async (url, options) => {
      calls.push([url, options]);
      return { ok: true };
    }
  });

  await client.saveReviewImageNeed({ contentDraft: { id: 'draft-1' }, imageNeed: { id: 'need-1' } });
  await client.saveAsset({ asset: { id: 'asset-1' } });
  await client.savePlacement({ placement: { id: 'placement-1' }, saga: { id: 'saga-1' } });
  await client.listOpenNeeds({ contentDraftId: 'draft-1' });
  await client.listStagedAssets();
  await client.listPlannedPlacements({ contentDraftId: 'draft-1' });
  await client.markSagaStep({}, 'saga-1', { currentStep: 2, status: 'running' });
  await client.markAssetPublishing({}, 'asset-1');
  await client.markPlacementPublishing({}, 'placement-1');
  await client.updateAssetPublication({}, {
    assetId: 'asset-1',
    assetPath: 'water-series/part-09/river-map',
    rawAssetUrl: 'https://raw.example.com/river-map.jpg'
  });
  await client.discardAsset('asset-1');
  await client.updatePlacementSnippet({}, {
    placementId: 'placement-1',
    snippet: '<figure></figure>',
    snippetFormat: 'html-figure'
  });
  await client.markPlaced({}, {
    placementId: 'placement-1',
    assetId: 'asset-1',
    publishedUrl: 'https://raw.example.com/river-map.jpg'
  });
  await client.markFailed({}, {
    sagaId: 'saga-1',
    error: new Error('download failed'),
    resolution: 'manual-review'
  });
  await client.listImageProviders();
  await client.searchImageProviders({ query: 'wetland', providers: ['pexels'], page: 2, perPage: 12 });
  await client.stageProviderImage({ provider: 'pexels', providerId: '1234' });

  assert.strictEqual(calls[0][0], 'https://ledger.example.com/api/review-image-needs');
  assert.strictEqual(calls[0][1].method, 'POST');
  assert.strictEqual(calls[0][1].token, 'secret');
  assert.deepStrictEqual(calls[0][1].body.imageNeed, { id: 'need-1' });
  assert.strictEqual(calls[1][0], 'https://ledger.example.com/api/assets');
  assert.deepStrictEqual(calls[1][1].body.asset, { id: 'asset-1' });
  assert.strictEqual(calls[2][0], 'https://ledger.example.com/api/placements');
  assert.strictEqual(calls[2][1].method, 'POST');
  assert.deepStrictEqual(calls[2][1].body.saga, { id: 'saga-1' });
  assert.strictEqual(calls[3][0], 'https://ledger.example.com/api/image-needs/open?contentDraftId=draft-1');
  assert.strictEqual(calls[3][1].method, 'GET');
  assert.strictEqual(calls[4][0], 'https://ledger.example.com/api/assets/staged');
  assert.strictEqual(calls[4][1].method, 'GET');
  assert.strictEqual(calls[5][0], 'https://ledger.example.com/api/placements/planned?contentDraftId=draft-1');
  assert.strictEqual(calls[5][1].method, 'GET');
  assert.strictEqual(calls[6][0], 'https://ledger.example.com/api/sagas/saga-1/step');
  assert.deepStrictEqual(calls[6][1].body, { currentStep: 2, status: 'running' });
  assert.strictEqual(calls[7][0], 'https://ledger.example.com/api/assets/asset-1/publishing');
  assert.strictEqual(calls[8][0], 'https://ledger.example.com/api/placements/placement-1/publishing');
  assert.strictEqual(calls[9][0], 'https://ledger.example.com/api/assets/asset-1/publication');
  assert.strictEqual(calls[9][1].body.assetPath, 'water-series/part-09/river-map');
  assert.strictEqual(calls[10][0], 'https://ledger.example.com/api/assets/asset-1/discarded');
  assert.strictEqual(calls[10][1].method, 'POST');
  assert.strictEqual(calls[11][0], 'https://ledger.example.com/api/placements/placement-1/snippet');
  assert.strictEqual(calls[11][1].body.snippetFormat, 'html-figure');
  assert.strictEqual(calls[12][0], 'https://ledger.example.com/api/placements/placement-1/placed');
  assert.strictEqual(calls[12][1].body.assetId, 'asset-1');
  assert.strictEqual(calls[13][0], 'https://ledger.example.com/api/sagas/saga-1/failed');
  assert.strictEqual(calls[13][1].body.error, 'download failed');
  assert.strictEqual(calls[14][0], 'https://ledger.example.com/api/image-providers');
  assert.strictEqual(calls[14][1].method, 'GET');
  assert.strictEqual(calls[15][0], 'https://ledger.example.com/api/image-providers/search?q=wetland&providers=pexels&page=2&perPage=12');
  assert.strictEqual(calls[15][1].method, 'GET');
  assert.strictEqual(calls[16][0], 'https://ledger.example.com/api/captures/provider-image');
  assert.strictEqual(calls[16][1].method, 'POST');
  assert.deepStrictEqual(calls[16][1].body, { provider: 'pexels', providerId: '1234' });
}

function testSettingsFactory() {
  const empty = createLedgerWriterFromSettings(fakeVscode({}));
  const client = createLedgerWriterFromSettings(fakeVscode({
    ledgerApiUrl: 'https://ledger.example.com',
    ledgerApiToken: 'token'
  }));

  assert.strictEqual(empty, null);
  assert.strictEqual(typeof client.saveAsset, 'function');
  assert.strictEqual(typeof client.savePlacement, 'function');
  assert.strictEqual(typeof client.listImageProviders, 'function');
  assert.strictEqual(typeof client.searchImageProviders, 'function');
  assert.strictEqual(typeof client.stageProviderImage, 'function');
  assert.strictEqual(typeof client.listOpenNeeds, 'function');
  assert.strictEqual(typeof client.listPlannedPlacements, 'function');
  assert.strictEqual(typeof client.discardAsset, 'function');
  assert.strictEqual(typeof client.markPlaced, 'function');
  assert.strictEqual(typeof client.markFailed, 'function');
}

function fakeVscode(settings) {
  return {
    workspace: {
      getConfiguration: () => ({
        get: (key, defaultValue) => settings[key] || defaultValue
      })
    }
  };
}

(async () => {
  await testClientPostsExpectedPayloads();
  testSettingsFactory();
  console.log('ledgerApiClient tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
