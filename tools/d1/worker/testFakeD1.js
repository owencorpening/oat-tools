'use strict';

const assert = require('assert');

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
    if (/^\s*UPDATE\s+/i.test(this.sql)) return this.runUpdate();
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
    if (/draft_title/i.test(this.sql)) {
      const placements = this.db.tables.get('asset_placement') || [];
      const drafts = this.db.tables.get('content_draft') || [];
      const rows = [...(this.db.tables.get('asset') || [])]
        .sort(byCreatedAt)
        .map(row => {
          const placement = [...placements]
            .filter(candidate => candidate.asset_id === row.id)
            .sort(byCreatedAt)
            .pop() || {};
          const draft = drafts.find(candidate => candidate.id === placement.content_draft_id) || {};
          return {
            ...row,
            placement_target: placement.target,
            placement_status: placement.status,
            placement_published_url: placement.published_url,
            placement_updated_at: placement.updated_at,
            draft_title: draft.title,
            draft_path: draft.draft_path
          };
        });
      return { results: rows };
    }
    if (/FROM\s+asset\s+WHERE\s+id\s*=\s*\?/i.test(this.sql)) {
      const row = (this.db.tables.get('asset') || []).find(candidate => candidate.id === this.values[0]);
      return { results: row ? [row] : [] };
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

  runUpdate() {
    if (/UPDATE\s+asset_saga[\s\S]+retry_count\s*=\s*retry_count\s*\+\s*1/i.test(this.sql)) {
      const sagaId = this.values[4];
      const row = this.db.one('asset_saga', sagaId);
      Object.assign(row, {
        status: 'failed',
        resolution: this.values[0],
        last_error: this.values[1],
        retry_count: (row.retry_count || 0) + 1,
        next_retry_at: this.values[2],
        updated_at: this.values[3]
      });
      return { success: true };
    }

    const match = this.sql.match(/UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+id\s*=\s*\?/i);
    assert(match, `unparsed update: ${this.sql}`);
    const table = match[1];
    const assignments = match[2]
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
    const id = this.values[assignments.length];
    const row = this.db.one(table, id);

    assignments.forEach((assignment, index) => {
      const column = assignment.split('=')[0].trim();
      const literal = assignment.match(/=\s*'([^']*)'/);
      row[column] = literal ? literal[1] : this.values[index];
    });

    return { success: true };
  }
}

function byCreatedAt(a, b) {
  return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

module.exports = { FakeD1, FakeStatement, byCreatedAt };
