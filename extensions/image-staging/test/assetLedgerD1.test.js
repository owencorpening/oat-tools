'use strict';

const assert = require('assert');
const ledger = require('../lib/assetLedgerD1');

async function testCreateRowsAndFieldMapping() {
  const db = new FakeD1();

  await ledger.createContentItem(db, {
    id: 'content-1',
    type: 'article',
    title: 'Water Part IX',
    slug: 'water-part-ix',
    contentRepoPath: '/content',
    sourcePath: 'part-09.md'
  });
  await ledger.createContentDraft(db, {
    id: 'draft-1',
    contentItemId: 'content-1',
    contentRepoPath: '/content',
    draftPath: 'part-09.md',
    headingAnchor: 'heading'
  });
  await ledger.createAsset(db, {
    id: 'asset-1',
    assetType: 'image',
    slug: 'river-map',
    displayName: 'River Map',
    sourceUrl: 'https://example.com/river-map.jpg',
    imageSrc: 'https://example.com/river-map.jpg',
    contentHash: 'sha256:abc',
    photographer: 'Owen',
    license: 'OAT',
    intakeSection: 'water-series/part-09'
  });
  await ledger.createPlacement(db, {
    id: 'placement-1',
    assetId: 'asset-1',
    contentDraftId: 'draft-1',
    target: 'substack',
    figureNumber: '2',
    draftLocation: { path: 'part-09.md', lineStart: 10 },
    snippetFormat: 'html-figure'
  });
  await ledger.createImageNeed(db, {
    id: 'need-1',
    contentDraftId: 'draft-1',
    draftLocation: { path: 'part-09.md', heading: 'Maps' },
    reason: 'needs map',
    neededAssetKind: 'map'
  });
  await ledger.createSaga(db, {
    id: 'saga-1',
    assetId: 'asset-1',
    assetPlacementId: 'placement-1',
    imageNeedId: 'need-1'
  });

  assert.strictEqual(db.one('content_item', 'content-1').source_path, 'part-09.md');
  assert.strictEqual(db.one('content_draft', 'draft-1').heading_anchor, 'heading');
  assert.strictEqual(db.one('asset', 'asset-1').display_name, 'River Map');
  assert.strictEqual(db.one('asset', 'asset-1').content_hash, 'sha256:abc');
  assert.deepStrictEqual(
    JSON.parse(db.one('asset_placement', 'placement-1').draft_location_json),
    { path: 'part-09.md', lineStart: 10 }
  );
  assert.strictEqual(db.one('image_need', 'need-1').status, 'open');
  assert.strictEqual(db.one('asset_saga', 'saga-1').resolution, 'auto-retry');
}

async function testUpdatesAndFailureState() {
  const db = new FakeD1();
  seedAssetGraph(db);

  await ledger.markSagaStep(db, 'saga-1', {
    currentStep: 3,
    status: 'running',
    resolution: 'auto-retry',
    compensation: 'Retry same asset path'
  });
  await ledger.markAssetPublishing(db, 'asset-1');
  await ledger.markPlacementPublishing(db, 'placement-1');
  await ledger.updateAssetPublication(db, {
    assetId: 'asset-1',
    assetPath: 'water-series/part-09/river-map',
    rawAssetUrl: 'https://raw.example.com/river-map.jpg'
  });
  await ledger.updatePlacementSnippet(db, {
    placementId: 'placement-1',
    snippet: '<figure></figure>',
    snippetFormat: 'html-figure'
  });
  await ledger.markPlaced(db, {
    placementId: 'placement-1',
    assetId: 'asset-1',
    publishedUrl: 'https://raw.example.com/river-map.jpg'
  });
  await ledger.markFailed(db, {
    sagaId: 'saga-1',
    error: new Error('push failed'),
    resolution: 'manual-review',
    nextRetryAt: '2026-06-08T00:00:00.000Z'
  });

  assert.strictEqual(db.one('asset_saga', 'saga-1').current_step, 3);
  assert.strictEqual(db.one('asset_saga', 'saga-1').status, 'failed');
  assert.strictEqual(db.one('asset_saga', 'saga-1').retry_count, 1);
  assert.strictEqual(db.one('asset_saga', 'saga-1').last_error, 'push failed');
  assert.strictEqual(db.one('asset', 'asset-1').status, 'published');
  assert.strictEqual(db.one('asset', 'asset-1').asset_path, 'water-series/part-09/river-map');
  assert.strictEqual(db.one('asset_placement', 'placement-1').status, 'placed');
  assert.strictEqual(db.one('asset_placement', 'placement-1').snippet_format, 'html-figure');
}

async function testListQueries() {
  const db = new FakeD1();
  seedAssetGraph(db);
  db.insert('asset', { id: 'asset-2', status: 'candidate', created_at: '2026-01-01T00:00:00.000Z' });
  db.insert('asset', { id: 'asset-3', status: 'staged', created_at: '2026-01-02T00:00:00.000Z' });
  db.insert('image_need', { id: 'need-2', content_draft_id: 'draft-2', status: 'open', created_at: '2026-01-01T00:00:00.000Z' });
  db.insert('image_need', { id: 'need-3', content_draft_id: 'draft-1', status: 'resolved', created_at: '2026-01-02T00:00:00.000Z' });

  const openForDraft = await ledger.listOpenNeeds(db, { contentDraftId: 'draft-1' });
  const allOpen = await ledger.listOpenNeeds(db);
  const staged = await ledger.listStagedAssets(db);

  assert.deepStrictEqual(openForDraft.map(row => row.id), ['need-1']);
  assert.deepStrictEqual(allOpen.map(row => row.id), ['need-2', 'need-1']);
  assert.deepStrictEqual(staged.map(row => row.id), ['asset-1', 'asset-3']);
}

function seedAssetGraph(db) {
  db.insert('content_draft', { id: 'draft-1', draft_path: 'part-09.md', status: 'active' });
  db.insert('asset', { id: 'asset-1', status: 'staged', created_at: '2026-01-01T00:00:00.000Z' });
  db.insert('asset_placement', { id: 'placement-1', asset_id: 'asset-1', content_draft_id: 'draft-1', status: 'planned' });
  db.insert('image_need', { id: 'need-1', content_draft_id: 'draft-1', status: 'open', created_at: '2026-01-03T00:00:00.000Z' });
  db.insert('asset_saga', { id: 'saga-1', asset_id: 'asset-1', asset_placement_id: 'placement-1', current_step: 1, status: 'running', resolution: 'auto-retry', retry_count: 0 });
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
    if (/^\s*INSERT\s+INTO/i.test(this.sql)) return this.runInsert();
    if (/^\s*UPDATE/i.test(this.sql)) return this.runUpdate();
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

    if (/FROM\s+asset/i.test(this.sql)) {
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

  runUpdate() {
    const match = this.sql.match(/UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+id\s*=\s*\?/i);
    assert(match, `unparsed update: ${this.sql}`);
    const table = match[1];
    const row = this.db.one(table, this.values.at(-1));
    const assignments = match[2].split(',').map(part => part.trim()).filter(Boolean);
    let valueIndex = 0;

    for (const assignment of assignments) {
      let parsed = assignment.match(/^(\w+)\s*=\s*\?$/);
      if (parsed) {
        row[parsed[1]] = this.values[valueIndex++];
        continue;
      }

      parsed = assignment.match(/^(\w+)\s*=\s*'([^']*)'$/);
      if (parsed) {
        row[parsed[1]] = parsed[2];
        continue;
      }

      parsed = assignment.match(/^(\w+)\s*=\s*(\w+)\s*\+\s*(\d+)$/);
      if (parsed) {
        row[parsed[1]] = Number(row[parsed[2]] || 0) + Number(parsed[3]);
        continue;
      }

      throw new Error(`Unsupported assignment: ${assignment}`);
    }

    return { success: true };
  }
}

function byCreatedAt(a, b) {
  return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

(async () => {
  await testCreateRowsAndFieldMapping();
  await testUpdatesAndFailureState();
  await testListQueries();
  console.log('assetLedgerD1 tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
