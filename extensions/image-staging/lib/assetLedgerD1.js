'use strict';

async function createContentItem(db, item) {
  requireFields(item, ['id', 'type', 'title']);

  const row = {
    id: item.id,
    type: item.type,
    title: item.title,
    slug: item.slug,
    status: item.status || 'draft',
    content_repo_path: item.contentRepoPath,
    source_path: item.sourcePath,
    published_url: item.publishedUrl
  };

  await insert(db, 'content_item', row);
  return row;
}

async function createContentDraft(db, draft) {
  requireFields(draft, ['id', 'draftPath']);

  const row = {
    id: draft.id,
    content_item_id: draft.contentItemId,
    content_repo_path: draft.contentRepoPath,
    draft_path: draft.draftPath,
    title: draft.title,
    heading_anchor: draft.headingAnchor,
    status: draft.status || 'active'
  };

  await insert(db, 'content_draft', row);
  return row;
}

async function createAsset(db, asset) {
  requireFields(asset, ['id', 'assetType', 'slug', 'displayName']);

  const row = {
    id: asset.id,
    asset_type: asset.assetType,
    slug: asset.slug,
    display_name: asset.displayName,
    source_name: asset.sourceName,
    source_path: asset.sourcePath,
    source_url: asset.sourceUrl,
    image_src: asset.imageSrc,
    content_hash: asset.contentHash,
    photographer: asset.photographer,
    license: asset.license,
    attribution: asset.attribution,
    intake_section: asset.intakeSection,
    asset_path: asset.assetPath,
    raw_asset_url: asset.rawAssetUrl,
    status: asset.status || 'candidate'
  };

  await insert(db, 'asset', row);
  return row;
}

async function createPlacement(db, placement) {
  requireFields(placement, ['id', 'assetId', 'target']);
  if (!placement.contentItemId && !placement.contentDraftId) {
    throw new Error('createPlacement requires contentItemId or contentDraftId');
  }

  const row = {
    id: placement.id,
    asset_id: placement.assetId,
    content_item_id: placement.contentItemId,
    content_draft_id: placement.contentDraftId,
    target: placement.target,
    figure_number: placement.figureNumber,
    draft_location_json: jsonString(placement.draftLocation),
    snippet: placement.snippet,
    snippet_format: placement.snippetFormat,
    status: placement.status || 'planned',
    published_url: placement.publishedUrl
  };

  await insert(db, 'asset_placement', row);
  return row;
}

async function createImageNeed(db, need) {
  requireFields(need, ['id', 'contentDraftId', 'reason']);

  const row = {
    id: need.id,
    content_draft_id: need.contentDraftId,
    draft_location_json: jsonString(need.draftLocation),
    reason: need.reason,
    needed_asset_kind: need.neededAssetKind,
    status: need.status || 'open',
    resolved_asset_id: need.resolvedAssetId,
    resolved_placement_id: need.resolvedPlacementId,
    resolved_at: need.resolvedAt
  };

  await insert(db, 'image_need', row);
  return row;
}

async function createSaga(db, saga) {
  requireFields(saga, ['id']);
  if (!saga.assetId && !saga.assetPlacementId && !saga.imageNeedId) {
    throw new Error('createSaga requires assetId, assetPlacementId, or imageNeedId');
  }

  const row = {
    id: saga.id,
    asset_id: saga.assetId,
    asset_placement_id: saga.assetPlacementId,
    image_need_id: saga.imageNeedId,
    current_step: saga.currentStep || 1,
    status: saga.status || 'running',
    resolution: saga.resolution || 'auto-retry',
    compensation: saga.compensation,
    last_error: saga.lastError,
    retry_count: saga.retryCount || 0,
    next_retry_at: saga.nextRetryAt
  };

  await insert(db, 'asset_saga', row);
  return row;
}

async function markSagaStep(db, sagaId, updates = {}) {
  const fields = {
    current_step: updates.currentStep,
    status: updates.status,
    resolution: updates.resolution,
    compensation: updates.compensation,
    last_error: updates.lastError,
    next_retry_at: updates.nextRetryAt,
    updated_at: now()
  };

  await updateById(db, 'asset_saga', sagaId, fields);
}

async function markAssetPublishing(db, assetId) {
  if (!assetId) throw new Error('markAssetPublishing requires assetId');

  await updateById(db, 'asset', assetId, {
    status: 'publishing',
    updated_at: now()
  });
}

async function markPlacementPublishing(db, placementId) {
  if (!placementId) throw new Error('markPlacementPublishing requires placementId');

  await updateById(db, 'asset_placement', placementId, {
    status: 'publishing',
    updated_at: now()
  });
}

async function updateAssetPublication(db, { assetId, assetPath, rawAssetUrl } = {}) {
  if (!assetId) throw new Error('updateAssetPublication requires assetId');

  await updateById(db, 'asset', assetId, {
    asset_path: assetPath,
    raw_asset_url: rawAssetUrl,
    updated_at: now()
  });
}

async function markAssetPublished(db, { assetId, assetPath, rawAssetUrl } = {}) {
  if (!assetId) throw new Error('markAssetPublished requires assetId');

  await updateById(db, 'asset', assetId, {
    status: 'published',
    asset_path: assetPath,
    raw_asset_url: rawAssetUrl,
    updated_at: now()
  });
}

async function markAssetDiscarded(db, assetId) {
  if (!assetId) throw new Error('markAssetDiscarded requires assetId');

  await updateById(db, 'asset', assetId, {
    status: 'discarded',
    updated_at: now()
  });
}

async function updatePlacementSnippet(db, { placementId, snippet, snippetFormat } = {}) {
  if (!placementId) throw new Error('updatePlacementSnippet requires placementId');

  await updateById(db, 'asset_placement', placementId, {
    snippet,
    snippet_format: snippetFormat,
    updated_at: now()
  });
}

async function markPlaced(db, { placementId, assetId, publishedUrl } = {}) {
  if (!placementId) throw new Error('markPlaced requires placementId');

  await updateById(db, 'asset_placement', placementId, {
    status: 'placed',
    published_url: publishedUrl,
    updated_at: now()
  });

  if (assetId) {
    await updateById(db, 'asset', assetId, {
      status: 'published',
      updated_at: now()
    });
  }
}

async function markFailed(db, { sagaId, error, resolution = 'manual-review', nextRetryAt } = {}) {
  if (!sagaId) throw new Error('markFailed requires sagaId');

  await db.prepare(`
    UPDATE asset_saga
       SET status = 'failed',
           resolution = ?,
           last_error = ?,
           retry_count = retry_count + 1,
           next_retry_at = ?,
           updated_at = ?
     WHERE id = ?
  `).bind(resolution, messageFor(error), nextRetryAt || null, now(), sagaId).run();
}

async function listOpenNeeds(db, { contentDraftId } = {}) {
  if (contentDraftId) {
    return all(db.prepare(`
      SELECT *
        FROM image_need
       WHERE status = 'open'
         AND content_draft_id = ?
       ORDER BY created_at ASC
    `).bind(contentDraftId));
  }

  return all(db.prepare(`
    SELECT *
      FROM image_need
     WHERE status = 'open'
     ORDER BY created_at ASC
  `));
}

async function listStagedAssets(db) {
  return all(db.prepare(`
    SELECT *
      FROM asset
     WHERE status = 'staged'
     ORDER BY created_at ASC
  `));
}

async function listAssets(db) {
  return all(db.prepare(`
    SELECT
      a.*,
      p.target AS placement_target,
      p.status AS placement_status,
      p.published_url AS placement_published_url,
      p.updated_at AS placement_updated_at,
      d.title AS draft_title,
      d.draft_path AS draft_path
      FROM asset a
      LEFT JOIN asset_placement p
        ON p.id = (
          SELECT id
            FROM asset_placement
           WHERE asset_id = a.id
           ORDER BY created_at DESC
           LIMIT 1
        )
      LEFT JOIN content_draft d
        ON d.id = p.content_draft_id
     ORDER BY a.created_at ASC
  `));
}

async function listPlannedPlacements(db, { contentDraftId } = {}) {
  const sql = `
    SELECT
      p.id AS placement_id,
      p.asset_id AS placement_asset_id,
      p.content_item_id,
      p.content_draft_id,
      p.target,
      p.figure_number,
      p.draft_location_json,
      p.snippet,
      p.snippet_format,
      p.status AS placement_status,
      p.published_url,
      p.created_at AS placement_created_at,
      p.updated_at AS placement_updated_at,
      a.id AS asset_id,
      a.asset_type,
      a.slug,
      a.display_name,
      a.source_name,
      a.source_path,
      a.source_url,
      a.image_src,
      a.content_hash,
      a.photographer,
      a.license,
      a.attribution,
      a.intake_section,
      a.asset_path,
      a.raw_asset_url,
      a.status AS asset_status,
      s.id AS saga_id,
      s.current_step,
      s.status AS saga_status,
      s.resolution,
      s.compensation,
      s.last_error,
      s.retry_count,
      s.next_retry_at,
      d.content_repo_path,
      d.draft_path,
      d.title AS draft_title,
      d.heading_anchor
    FROM asset_placement p
    JOIN asset a ON a.id = p.asset_id
    LEFT JOIN asset_saga s ON s.asset_placement_id = p.id
    LEFT JOIN content_draft d ON d.id = p.content_draft_id
   WHERE p.status = 'planned'
     ${contentDraftId ? 'AND p.content_draft_id = ?' : ''}
   ORDER BY p.created_at ASC
  `;

  const statement = db.prepare(sql);
  return all(contentDraftId ? statement.bind(contentDraftId) : statement);
}

async function insert(db, table, row) {
  const clean = compact(row);
  const columns = Object.keys(clean);
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map(column => clean[column]);

  await db.prepare(`
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders})
  `).bind(...values).run();
}

async function updateById(db, table, id, fields) {
  if (!id) throw new Error(`update ${table} requires id`);

  const clean = compact(fields);
  const columns = Object.keys(clean);
  if (columns.length === 0) return;

  const assignments = columns.map(column => `${column} = ?`).join(', ');
  const values = columns.map(column => clean[column]);

  await db.prepare(`
    UPDATE ${table}
       SET ${assignments}
     WHERE id = ?
  `).bind(...values, id).run();
}

async function all(statement) {
  const result = await statement.all();
  return result.results || [];
}

function compact(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined)
  );
}

function jsonString(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function messageFor(error) {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

function requireFields(record, fields) {
  for (const field of fields) {
    if (!record || record[field] === undefined || record[field] === null || record[field] === '') {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

function now() {
  return new Date().toISOString();
}

module.exports = {
  createContentItem,
  createContentDraft,
  createAsset,
  createPlacement,
  createImageNeed,
  createSaga,
  markSagaStep,
  markAssetPublishing,
  markPlacementPublishing,
  updateAssetPublication,
  markAssetPublished,
  markAssetDiscarded,
  updatePlacementSnippet,
  markPlaced,
  markFailed,
  listOpenNeeds,
  listAssets,
  listStagedAssets,
  listPlannedPlacements
};
