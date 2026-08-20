'use strict';

const assert = require('assert');
const crypto = require('node:crypto');
const { buildSyncPlan, syncLedgerToSheet } = require('./sheetSync');
const { getAccessToken, signJwt } = require('./googleServiceAccountAuth');
const { FakeD1 } = require('./testFakeD1');

function base64UrlDecode(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(segment.length + (4 - (segment.length % 4)) % 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function testBuildSyncPlanRefreshesStatusColumnsOnMatchedRow() {
  const assets = [{ source_url: 'https://example.com/a', status: 'staged', placement_status: null }];
  const sheetValues = [
    ['Timestamp', 'Name', 'Source URL'],
    ['2026-01-01', 'a', 'https://example.com/a', '', '', '', '', 'old-status', '', '', '', '']
  ];
  const { updates, appendRows } = buildSyncPlan(assets, sheetValues);

  assert.strictEqual(appendRows.length, 0);
  const statusUpdate = updates.find(u => u.statusCols);
  assert.deepStrictEqual(statusUpdate, { row: 2, statusCols: ['staged', '', '', ''] });
}

function testBuildSyncPlanFillsPostTitleOnlyWhenEmpty() {
  const assets = [{ source_url: 'https://example.com/a', status: 'staged', draft_title: 'Part IX' }];
  const emptyF = [['h'], ['t', 'n', 'https://example.com/a', '', '', '', '', 's', '', '', '', '']];
  const filledF = [['h'], ['t', 'n', 'https://example.com/a', '', '', 'Existing Title', '', 's', '', '', '', '']];

  assert.strictEqual(buildSyncPlan(assets, emptyF).updates.some(u => u.fillF === 'Part IX'), true);
  assert.strictEqual(buildSyncPlan(assets, filledF).updates.some(u => u.fillF !== undefined), false);
}

function testBuildSyncPlanFillsImageSrcOnlyWhenEmpty() {
  const assets = [{ source_url: 'https://example.com/a', status: 'staged', image_src: 'https://cdn/x.jpg' }];
  const emptyL = [['h'], ['t', 'n', 'https://example.com/a', '', '', '', '', 's', '', '', '', '']];
  const filledL = [['h'], ['t', 'n', 'https://example.com/a', '', '', '', '', 's', '', '', '', 'https://cdn/existing.jpg']];

  assert.strictEqual(buildSyncPlan(assets, emptyL).updates.some(u => u.fillL === 'https://cdn/x.jpg'), true);
  assert.strictEqual(buildSyncPlan(assets, filledL).updates.some(u => u.fillL !== undefined), false);
}

function testBuildSyncPlanSkipsEmptySourceUrl() {
  const assets = [{ source_url: '', status: 'staged' }];
  const { updates, appendRows } = buildSyncPlan(assets, [['h']]);
  assert.strictEqual(updates.length, 0);
  assert.strictEqual(appendRows.length, 0);
}

function testBuildSyncPlanSkipsDiscardedAssetNotInSheet() {
  const assets = [{ source_url: 'https://example.com/new', status: 'discarded' }];
  const { updates, appendRows } = buildSyncPlan(assets, [['h']]);
  assert.strictEqual(updates.length, 0);
  assert.strictEqual(appendRows.length, 0);
}

function testBuildSyncPlanAppendsUnmatchedAssetAsFullRow() {
  const assets = [{
    source_url: 'https://example.com/new',
    status: 'staged',
    source_name: 'newImage',
    photographer: 'Jane',
    license: 'CC0',
    attribution: 'Image: newImage, by Jane',
    image_src: 'https://cdn/new.jpg',
    created_at: '2026-08-19T10:00:00.000Z'
  }];
  const { updates, appendRows } = buildSyncPlan(assets, [['h']]);

  assert.strictEqual(updates.length, 0);
  assert.strictEqual(appendRows.length, 1);
  assert.deepStrictEqual(appendRows[0], [
    '2026-08-19T10:00:00.000Z',
    'newImage',
    'https://example.com/new',
    'Jane',
    'CC0',
    '',
    'Image: newImage, by Jane',
    'staged',
    '',
    '',
    '',
    'https://cdn/new.jpg'
  ]);
}

async function testSignJwtProducesValidThreeSegmentToken() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const claims = { iss: 'test@example.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: 1000, exp: 4600 };
  const jwt = await signJwt(claims, privateKey);
  const segments = jwt.split('.');

  assert.strictEqual(segments.length, 3);
  assert.deepStrictEqual(base64UrlDecode(segments[0]), { alg: 'RS256', typ: 'JWT' });
  assert.deepStrictEqual(base64UrlDecode(segments[1]), claims);
}

async function testGetAccessTokenSendsCorrectGrantType() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  let capturedBody;
  const env = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.iam.gserviceaccount.com',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
    fetch: async (url, options) => {
      capturedBody = options.body;
      return { ok: true, text: async () => JSON.stringify({ access_token: 'fake-token' }) };
    }
  };

  const token = await getAccessToken(env);
  assert.strictEqual(token, 'fake-token');
  assert.ok(capturedBody.includes('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'));
}

async function testGetAccessTokenSurfacesGoogleErrorText() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  const env = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.iam.gserviceaccount.com',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
    fetch: async () => ({ ok: false, status: 400, text: async () => '{"error":"invalid_grant"}' })
  };

  await assert.rejects(() => getAccessToken(env), /invalid_grant/);
}

async function testSyncLedgerToSheetBatchesUpdatesAndAppendsThenReturnsSummary() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  const db = new FakeD1();
  db.insert('asset', { id: 'a1', source_url: 'https://example.com/existing', status: 'staged', created_at: '2026-01-01' });
  db.insert('asset', { id: 'a2', source_url: 'https://example.com/new', status: 'staged', source_name: 'newImage', photographer: 'Jane', license: 'CC0', attribution: '', image_src: '', created_at: '2026-01-02' });

  const calls = [];
  const env = {
    DB: db,
    SHEET_ID: 'sheet-123',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.iam.gserviceaccount.com',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
    fetch: async (url, options) => {
      calls.push({ url, method: (options || {}).method || 'GET' });
      if (url === 'https://oauth2.googleapis.com/token') {
        return { ok: true, text: async () => JSON.stringify({ access_token: 'fake-token' }) };
      }
      if (url.endsWith('/values/Sheet1')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            values: [
              ['Timestamp', 'Name', 'Source URL'],
              ['2026-01-01', 'existing', 'https://example.com/existing', '', '', '', '', 'old-status', '', '', '', '']
            ]
          })
        };
      }
      if (url.includes(':batchUpdate')) return { ok: true, text: async () => '{}' };
      if (url.includes(':append')) return { ok: true, text: async () => '{}' };
      throw new Error(`unexpected fetch: ${url}`);
    }
  };

  const summary = await syncLedgerToSheet(env);
  assert.deepStrictEqual(summary, { updated: 1, appended: 1, total: 2 });

  const batchCalls = calls.filter(c => c.url.includes(':batchUpdate'));
  const appendCalls = calls.filter(c => c.url.includes(':append'));
  assert.strictEqual(batchCalls.length, 1, 'expected exactly one batched update call');
  assert.strictEqual(appendCalls.length, 1, 'expected exactly one append call');
}

(async () => {
  testBuildSyncPlanRefreshesStatusColumnsOnMatchedRow();
  testBuildSyncPlanFillsPostTitleOnlyWhenEmpty();
  testBuildSyncPlanFillsImageSrcOnlyWhenEmpty();
  testBuildSyncPlanSkipsEmptySourceUrl();
  testBuildSyncPlanSkipsDiscardedAssetNotInSheet();
  testBuildSyncPlanAppendsUnmatchedAssetAsFullRow();
  await testSignJwtProducesValidThreeSegmentToken();
  await testGetAccessTokenSendsCorrectGrantType();
  await testGetAccessTokenSurfacesGoogleErrorText();
  await testSyncLedgerToSheetBatchesUpdatesAndAppendsThenReturnsSummary();
  console.log('sheetSync tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
