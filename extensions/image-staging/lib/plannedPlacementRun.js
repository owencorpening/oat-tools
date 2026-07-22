'use strict';

function buildPlacementRunInput(row, options = {}) {
  requireValue(row, 'row');

  const asset = assetFromPlannedRow(row);
  const placement = placementFromPlannedRow(row);
  const sagaId = row.saga_id || row.sagaId;

  requireValue(asset.id, 'asset.id');
  requireValue(asset.slug, 'asset.slug');
  requireValue(placement.id, 'placement.id');
  requireValue(placement.target, 'placement.target');
  requireValue(sagaId, 'sagaId');

  return {
    ...options,
    sagaId,
    asset,
    placement
  };
}

function assetFromPlannedRow(row = {}) {
  return {
    id: row.asset_id || row.assetId,
    assetType: row.asset_type || row.assetType,
    slug: row.slug,
    displayName: row.display_name || row.displayName,
    sourceName: row.source_name || row.sourceName,
    sourcePath: row.source_path || row.sourcePath,
    sourceKind: row.source_kind || row.sourceKind,
    sourceUrl: row.source_url || row.sourceUrl,
    imageSrc: row.image_src || row.imageSrc,
    contentHash: row.content_hash || row.contentHash,
    photographer: row.photographer,
    license: row.license,
    attribution: row.attribution,
    intakeSection: row.intake_section || row.intakeSection,
    assetPath: row.asset_path || row.assetPath,
    rawAssetUrl: row.raw_asset_url || row.rawAssetUrl,
    status: row.asset_status || row.assetStatus
  };
}

function placementFromPlannedRow(row = {}) {
  return {
    id: row.placement_id || row.placementId || row.id,
    assetId: row.placement_asset_id || row.asset_id || row.assetId,
    contentItemId: row.content_item_id || row.contentItemId,
    contentDraftId: row.content_draft_id || row.contentDraftId,
    target: row.target,
    figureNumber: row.figure_number || row.figureNumber,
    draftLocation: parseDraftLocation(row.draft_location_json || row.draftLocation),
    snippet: row.snippet,
    snippetFormat: row.snippet_format || row.snippetFormat,
    status: row.placement_status || row.placementStatus,
    publishedUrl: row.published_url || row.publishedUrl
  };
}

function parseDraftLocation(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function requireValue(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`plannedPlacementRun requires ${name}`);
  }
}

module.exports = {
  buildPlacementRunInput,
  assetFromPlannedRow,
  placementFromPlannedRow,
  parseDraftLocation
};
