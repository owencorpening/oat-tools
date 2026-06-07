-- Fresh-start D1 ledger for the OAT image and table asset pipeline.
-- IDs are assigned by application code so records can be created offline and
-- retried idempotently.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS content_item (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (
    type IN ('article', 'carousel', 'linkedin-post', 'table', 'other')
  ),
  title TEXT NOT NULL,
  slug TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'planned', 'published', 'archived')
  ),
  content_repo_path TEXT,
  source_path TEXT,
  published_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (type, slug)
);

CREATE TABLE IF NOT EXISTS content_draft (
  id TEXT PRIMARY KEY,
  content_item_id TEXT REFERENCES content_item(id) ON DELETE SET NULL,
  content_repo_path TEXT,
  draft_path TEXT NOT NULL,
  title TEXT,
  heading_anchor TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'published', 'archived')
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (content_repo_path, draft_path)
);

CREATE TABLE IF NOT EXISTS asset (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL CHECK (
    asset_type IN ('image', 'table-screenshot', 'diagram', 'source-file', 'hosted-media', 'other')
  ),
  slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source_name TEXT,
  source_path TEXT,
  source_url TEXT,
  image_src TEXT,
  content_hash TEXT,
  photographer TEXT,
  license TEXT,
  attribution TEXT,
  intake_section TEXT,
  asset_path TEXT,
  raw_asset_url TEXT,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (
    status IN ('candidate', 'staged', 'publishing', 'published', 'discarded', 'needs-provenance')
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (content_hash),
  UNIQUE (asset_path)
);

CREATE TABLE IF NOT EXISTS asset_placement (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  content_item_id TEXT REFERENCES content_item(id) ON DELETE SET NULL,
  content_draft_id TEXT REFERENCES content_draft(id) ON DELETE SET NULL,
  target TEXT NOT NULL CHECK (
    target IN ('substack', 'carousel', 'linkedin-post', 'raw-github', 'other')
  ),
  figure_number TEXT,
  draft_location_json TEXT,
  snippet TEXT,
  snippet_format TEXT CHECK (
    snippet_format IS NULL OR snippet_format IN (
      'html-figure',
      'marp-image',
      'linkedin-handoff-text',
      'raw-url',
      'other'
    )
  ),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (
    status IN ('planned', 'publishing', 'placed', 'published', 'removed', 'failed')
  ),
  published_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (content_item_id IS NOT NULL OR content_draft_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS image_need (
  id TEXT PRIMARY KEY,
  content_draft_id TEXT NOT NULL REFERENCES content_draft(id) ON DELETE CASCADE,
  draft_location_json TEXT,
  reason TEXT NOT NULL,
  needed_asset_kind TEXT CHECK (
    needed_asset_kind IS NULL OR needed_asset_kind IN (
      'photo',
      'diagram',
      'map',
      'table',
      'ai-image',
      'other'
    )
  ),
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'resolved', 'dismissed')
  ),
  resolved_asset_id TEXT REFERENCES asset(id) ON DELETE SET NULL,
  resolved_placement_id TEXT REFERENCES asset_placement(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS asset_saga (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES asset(id) ON DELETE CASCADE,
  asset_placement_id TEXT REFERENCES asset_placement(id) ON DELETE CASCADE,
  image_need_id TEXT REFERENCES image_need(id) ON DELETE SET NULL,
  current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 7),
  status TEXT NOT NULL DEFAULT 'running' CHECK (
    status IN ('running', 'succeeded', 'failed', 'abandoned')
  ),
  resolution TEXT NOT NULL DEFAULT 'auto-retry' CHECK (
    resolution IN ('auto-retry', 'manual-review', 'discard')
  ),
  compensation TEXT,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (asset_id IS NOT NULL OR asset_placement_id IS NOT NULL OR image_need_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_content_draft_status
  ON content_draft(status);

CREATE INDEX IF NOT EXISTS idx_asset_status
  ON asset(status);

CREATE INDEX IF NOT EXISTS idx_asset_content_hash
  ON asset(content_hash);

CREATE INDEX IF NOT EXISTS idx_asset_placement_asset
  ON asset_placement(asset_id);

CREATE INDEX IF NOT EXISTS idx_asset_placement_status
  ON asset_placement(status);

CREATE INDEX IF NOT EXISTS idx_asset_placement_target
  ON asset_placement(target);

CREATE INDEX IF NOT EXISTS idx_image_need_draft_status
  ON image_need(content_draft_id, status);

CREATE INDEX IF NOT EXISTS idx_asset_saga_status_retry
  ON asset_saga(status, resolution, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_asset_saga_asset
  ON asset_saga(asset_id);
