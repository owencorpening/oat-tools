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
  assert.strictEqual(typeof client.listOpenNeeds, 'function');
  assert.strictEqual(typeof client.listPlannedPlacements, 'function');
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
