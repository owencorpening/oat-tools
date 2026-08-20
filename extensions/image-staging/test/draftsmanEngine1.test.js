'use strict';

const assert = require('assert');
const { isAutoInsertSafe, attemptAutoResolve, stageResult } = require('../lib/draftsmanEngine1');

// Realistic fixtures pulled from the real provider modules' normalizePhoto()
// output shapes (tools/d1/worker/imageProviders/*.js), not invented shapes.

const pexelsShape = { provider: 'pexels', requiresAttribution: false, allowsCommercialUse: true, allowsModification: true };
const openverseByShape = { provider: 'openverse', requiresAttribution: true, allowsCommercialUse: true, allowsModification: true };
const openverseByNdShape = { provider: 'openverse', requiresAttribution: true, allowsCommercialUse: true, allowsModification: false };
const openverseByNcShape = { provider: 'openverse', requiresAttribution: true, allowsCommercialUse: false, allowsModification: true };
const wikimediaUnclassifiedShape = { provider: 'wikimedia', requiresAttribution: undefined, allowsCommercialUse: undefined, allowsModification: undefined, needsReview: true };
const wikimediaCc0Shape = { provider: 'wikimedia', requiresAttribution: false, allowsCommercialUse: true, allowsModification: true, needsReview: false };

function testIsAutoInsertSafeTruthTable() {
  assert.strictEqual(isAutoInsertSafe(pexelsShape), true);
  assert.strictEqual(isAutoInsertSafe(openverseByShape), true);
  assert.strictEqual(isAutoInsertSafe(wikimediaCc0Shape), true);

  assert.strictEqual(isAutoInsertSafe(openverseByNdShape), false, 'CC BY-ND (no derivatives) must not auto-insert');
  assert.strictEqual(isAutoInsertSafe(openverseByNcShape), false, 'CC BY-NC (non-commercial) must not auto-insert — OAT publishes commercially');
  assert.strictEqual(isAutoInsertSafe(wikimediaUnclassifiedShape), false, 'undefined/needs-review must not auto-insert');
  assert.strictEqual(isAutoInsertSafe(null), false);
  assert.strictEqual(isAutoInsertSafe(undefined), false);
}

async function testAttemptAutoResolvePicksFirstSafeResult() {
  const search = async () => [openverseByNdShape, wikimediaUnclassifiedShape, pexelsShape, openverseByShape];
  const result = await attemptAutoResolve({ query: 'wetland', ledgerWriter: {}, search });
  assert.strictEqual(result, pexelsShape, 'should skip unsafe results and return the first safe one, not literal results[0]');
}

async function testAttemptAutoResolveReturnsNullWhenNoneSafe() {
  const search = async () => [openverseByNdShape, openverseByNcShape, wikimediaUnclassifiedShape];
  const result = await attemptAutoResolve({ query: 'wetland', ledgerWriter: {}, search });
  assert.strictEqual(result, null);
}

async function testAttemptAutoResolveReturnsNullOnEmptyResults() {
  const search = async () => [];
  const result = await attemptAutoResolve({ query: 'wetland', ledgerWriter: {}, search });
  assert.strictEqual(result, null);
}

async function testSearchStockPassthroughIsUsedByDefault() {
  let capturedArgs = null;
  const ledgerWriter = {
    searchImageProviders: async args => {
      capturedArgs = args;
      return { results: [pexelsShape] };
    }
  };
  const result = await attemptAutoResolve({ query: 'wetland restoration', ledgerWriter, providers: ['pexels'] });
  assert.strictEqual(result, pexelsShape);
  assert.deepStrictEqual(capturedArgs, { query: 'wetland restoration', providers: ['pexels'] });
}

async function testStageResultSendsExpectedPayload() {
  let capturedPayload = null;
  const ledgerWriter = {
    stageProviderImage: async payload => { capturedPayload = payload; return { asset: { id: 'asset-1' } }; }
  };
  const result = { provider: 'pexels', providerId: '123', sourceUrl: 'https://pexels.com/photo/123', ...pexelsShape };

  const response = await stageResult({ ledgerWriter, result });

  assert.deepStrictEqual(capturedPayload, {
    provider: 'pexels',
    providerId: '123',
    sourceUrl: 'https://pexels.com/photo/123',
    result
  });
  assert.deepStrictEqual(response, { asset: { id: 'asset-1' } });
}

(async () => {
  testIsAutoInsertSafeTruthTable();
  await testAttemptAutoResolvePicksFirstSafeResult();
  await testAttemptAutoResolveReturnsNullWhenNoneSafe();
  await testAttemptAutoResolveReturnsNullOnEmptyResults();
  await testSearchStockPassthroughIsUsedByDefault();
  await testStageResultSendsExpectedPayload();
  console.log('draftsmanEngine1 tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
