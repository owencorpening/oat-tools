'use strict';

const assert = require('assert');
const { handleRequest } = require('./index');

async function testCreateAsset() {
  const env = { DB: new FakeD1(), LEDGER_API_TOKEN: 'secret' };
  const response = await handleRequest(jsonRequest('/assets', {
    asset: {
      id: 'asset-1',
      assetType: 'image',
      slug: 'river-map',
      displayName: 'River Map',
      sourceUrl: 'https://example.com/river-map.jpg',
      photographer: 'Owen',
      license: 'OAT'
    }
  }, 'secret'), env);
  const body = await response.json();

  assert.strictEqual(response.status, 201);
  assert.strictEqual(body.asset.display_name, 'River Map');
  assert.strictEqual(env.DB.one('asset', 'asset-1').source_url, 'https://example.com/river-map.jpg');
}

async function testCreateReviewImageNeedUpsertsDraft() {
  const env = { DB: new FakeD1() };
  const payload = {
    contentDraft: {
      id: 'draft-1',
      draftPath: 'part-09.md',
      title: 'Old Title',
      headingAnchor: 'old'
    },
    imageNeed: {
      id: 'need-1',
      contentDraftId: 'draft-1',
      reason: 'needs map',
      neededAssetKind: 'map'
    }
  };

  let response = await handleRequest(jsonRequest('/review-image-needs', payload), env);
  assert.strictEqual(response.status, 201);
  assert.strictEqual(env.DB.one('content_draft', 'draft-1').title, 'Old Title');

  response = await handleRequest(jsonRequest('/review-image-needs', {
    contentDraft: { ...payload.contentDraft, title: 'New Title' },
    imageNeed: { ...payload.imageNeed, id: 'need-2' }
  }), env);
  assert.strictEqual(response.status, 201);
  assert.strictEqual(env.DB.one('content_draft', 'draft-1').title, 'New Title');
  assert.strictEqual(env.DB.one('image_need', 'need-2').reason, 'needs map');
}

async function testCreatePlacementWithSaga() {
  const env = { DB: new FakeD1() };
  env.DB.insert('asset', { id: 'asset-1', status: 'staged' });

  const response = await handleRequest(jsonRequest('/placements', {
    contentDraft: {
      id: 'draft-1',
      draftPath: 'part-09.md',
      title: 'Water Part IX'
    },
    placement: {
      id: 'placement-1',
      assetId: 'asset-1',
      contentDraftId: 'draft-1',
      target: 'substack',
      figureNumber: '3',
      snippetFormat: 'html-figure'
    },
    saga: {
      id: 'saga-1',
      imageNeedId: 'need-1'
    }
  }), env);
  const body = await response.json();

  assert.strictEqual(response.status, 201);
  assert.strictEqual(body.placement.asset_id, 'asset-1');
  assert.strictEqual(body.placement.content_draft_id, 'draft-1');
  assert.strictEqual(body.saga.asset_id, 'asset-1');
  assert.strictEqual(body.saga.asset_placement_id, 'placement-1');
  assert.strictEqual(env.DB.one('content_draft', 'draft-1').title, 'Water Part IX');
  assert.strictEqual(env.DB.one('asset_placement', 'placement-1').target, 'substack');
  assert.strictEqual(env.DB.one('asset_saga', 'saga-1').image_need_id, 'need-1');
}

async function testListRoutes() {
  const env = { DB: new FakeD1() };
  env.DB.insert('asset', { id: 'asset-1', status: 'staged', created_at: '2026-01-01T00:00:00.000Z' });
  env.DB.insert('asset', { id: 'asset-2', status: 'candidate', created_at: '2026-01-02T00:00:00.000Z' });
  env.DB.insert('asset_placement', { id: 'placement-1', asset_id: 'asset-1', content_draft_id: 'draft-1', target: 'substack', status: 'planned', created_at: '2026-01-01T00:00:00.000Z' });
  env.DB.insert('asset_saga', { id: 'saga-1', asset_id: 'asset-1', asset_placement_id: 'placement-1', status: 'running', current_step: 1, resolution: 'auto-retry' });
  env.DB.insert('image_need', { id: 'need-1', content_draft_id: 'draft-1', status: 'open', created_at: '2026-01-01T00:00:00.000Z' });
  env.DB.insert('image_need', { id: 'need-2', content_draft_id: 'draft-2', status: 'open', created_at: '2026-01-02T00:00:00.000Z' });

  const assets = await (await handleRequest(new Request('https://ledger.test/assets/staged'), env)).json();
  const needs = await (await handleRequest(new Request('https://ledger.test/image-needs/open?contentDraftId=draft-1'), env)).json();
  const placements = await (await handleRequest(new Request('https://ledger.test/placements/planned?contentDraftId=draft-1'), env)).json();

  assert.deepStrictEqual(assets.assets.map(row => row.id), ['asset-1']);
  assert.deepStrictEqual(needs.imageNeeds.map(row => row.id), ['need-1']);
  assert.deepStrictEqual(placements.placements.map(row => row.placement_id), ['placement-1']);
  assert.strictEqual(placements.placements[0].saga_id, 'saga-1');
}

async function testAuthAndErrors() {
  let response = await handleRequest(jsonRequest('/assets', { asset: { id: 'asset-1' } }, 'wrong'), {
    DB: new FakeD1(),
    LEDGER_API_TOKEN: 'secret'
  });
  assert.strictEqual(response.status, 401);

  response = await handleRequest(new Request('https://ledger.test/assets', {
    method: 'POST',
    body: '{not json',
    headers: { 'Content-Type': 'application/json' }
  }), { DB: new FakeD1() });
  assert.strictEqual(response.status, 400);

  response = await handleRequest(new Request('https://ledger.test/nope'), { DB: new FakeD1() });
  assert.strictEqual(response.status, 404);
}

function jsonRequest(path, body, token) {
  return new Request(`https://ledger.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

class FakeD1 {
  constructor() {
    this.tables = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  insert(table, row) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    this.tables.get(table).push({ ...row });
  }

  upsert(table, row) {
    const existing = (this.tables.get(table) || []).find(candidate => candidate.id === row.id);
    if (existing) Object.assign(existing, row);
    else this.insert(table, row);
  }

  one(table, id) {
    const row = (this.tables.get(table) || []).find(candidate => candidate.id === id);
    assert(row, `expected ${table}.${id}`);
    return row;
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    if (/INSERT\s+INTO\s+content_draft[\s\S]+ON\s+CONFLICT/i.test(this.sql)) {
      this.db.upsert('content_draft', {
        id: this.values[0],
        content_item_id: this.values[1],
        content_repo_path: this.values[2],
        draft_path: this.values[3],
        title: this.values[4],
        heading_anchor: this.values[5],
        status: this.values[6]
      });
      return { success: true };
    }
    if (/^\s*INSERT\s+INTO/i.test(this.sql)) return this.runInsert();
    throw new Error(`Unsupported run SQL: ${this.sql}`);
  }

  async all() {
    if (/FROM\s+image_need/i.test(this.sql)) {
      const rows = [...(this.db.tables.get('image_need') || [])]
        .filter(row => row.status === 'open')
        .filter(row => !/content_draft_id\s*=\s*\?/i.test(this.sql) || row.content_draft_id === this.values[0])
        .sort(byCreatedAt);
      return { results: rows };
    }
    if (/FROM\s+asset_placement\s+p/i.test(this.sql)) {
      const assets = this.db.tables.get('asset') || [];
      const sagas = this.db.tables.get('asset_saga') || [];
      const rows = [...(this.db.tables.get('asset_placement') || [])]
        .filter(row => row.status === 'planned')
        .filter(row => !/p\.content_draft_id\s*=\s*\?/i.test(this.sql) || row.content_draft_id === this.values[0])
        .sort(byCreatedAt)
        .map(row => {
          const asset = assets.find(candidate => candidate.id === row.asset_id) || {};
          const saga = sagas.find(candidate => candidate.asset_placement_id === row.id) || {};
          return {
            placement_id: row.id,
            placement_asset_id: row.asset_id,
            content_draft_id: row.content_draft_id,
            target: row.target,
            placement_status: row.status,
            asset_id: asset.id,
            display_name: asset.display_name,
            saga_id: saga.id,
            saga_status: saga.status
          };
      });
      return { results: rows };
    }
    if (/FROM\s+asset\b/i.test(this.sql)) {
      const rows = [...(this.db.tables.get('asset') || [])]
        .filter(row => row.status === 'staged')
        .sort(byCreatedAt);
      return { results: rows };
    }
    throw new Error(`Unsupported all SQL: ${this.sql}`);
  }

  runInsert() {
    const match = this.sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/i);
    assert(match, `unparsed insert: ${this.sql}`);
    const columns = match[2].split(',').map(column => column.trim());
    const row = {};
    columns.forEach((column, index) => {
      row[column] = this.values[index];
    });
    this.db.insert(match[1], row);
    return { success: true };
  }
}

function byCreatedAt(a, b) {
  return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

(async () => {
  await testCreateAsset();
  await testCreateReviewImageNeedUpsertsDraft();
  await testCreatePlacementWithSaga();
  await testListRoutes();
  await testAuthAndErrors();
  console.log('ledgerApiWorker tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
