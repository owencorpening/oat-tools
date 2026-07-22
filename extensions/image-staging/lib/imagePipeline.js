'use strict';

const assetLedger = require('./assetLedgerD1');
const assetRepo = require('./imageAssetsRepo');
const { buildSnippet } = require('./snippetBuilder');

async function placeAsset(options = {}) {
  const {
    db,
    sagaId,
    repoPath,
    writeSnippet,
    ledger = assetLedger,
    repo = assetRepo,
    download = true,
    commit = true
  } = options;
  const asset = normalizeAsset(options.asset);
  const placement = normalizePlacement(options.placement);

  requireValue(db, 'db');
  requireValue(sagaId, 'sagaId');
  requireValue(repoPath, 'repoPath');
  requireValue(asset.id, 'asset.id');
  requireValue(asset.slug, 'asset.slug');
  requireValue(placement.id, 'placement.id');
  requireValue(placement.target, 'placement.target');

  try {
    await setSagaStep(ledger, db, sagaId, 1, 'Mark asset and placement publishing');
    await ledger.markAssetPublishing(db, asset.id);
    await ledger.markPlacementPublishing(db, placement.id);

    await setSagaStep(ledger, db, sagaId, 2, 'Delete staging/final files if discarded before promotion');
    const repoPlacement = resolveRepoPlacement(asset, placement, options);
    const placedAsset = repo.createPlacedAsset({
      repoPath,
      image: asset,
      series: repoPlacement.series,
      partDir: repoPlacement.partDir,
      slug: asset.slug
    });

    await setSagaStep(ledger, db, sagaId, 3, 'Overwrite only when the content hash matches');
    if (download) {
      const isLocalSource = isLocalSourceKind(asset.sourceKind);
      if (isLocalSource && asset.sourcePath) {
        await repo.copyAsset({ src: asset.sourcePath, dest: placedAsset.imagePath });
      } else {
        await repo.downloadAsset({ url: placedAsset.downloadSrc, dest: placedAsset.imagePath });
      }

      // "Use" this asset with the ledger: archives provider provenance
      // (raw API response, attribution, retrieval time) for any asset that
      // has it, and — for providers that require it (currently only
      // Unsplash's download_location, per its API Guidelines) — registers
      // the use-time API call. The ledger endpoint is a no-op for assets
      // without provider metadata, so it's always safe to call. A failed
      // use-time obligation throws (propagates to the outer catch below)
      // rather than silently proceeding — that's a compliance requirement,
      // not a nice-to-have; missing provenance is not an error.
      if (ledger.recordAssetUse) {
        const record = await ledger.recordAssetUse(db, { assetId: asset.id });
        if (record && record.hasProvenance) {
          repo.writeProviderComplianceFiles(placedAsset.assetDir, {
            providerId: record.providerId,
            photographerUrl: record.photographerUrl,
            retrievedAt: record.retrievedAt,
            rawProviderRecord: record.rawProviderRecord,
            // Normalized per-provider template, not the raw attribution
            // field — see worker's buildAttributionText for why.
            attributionText: record.attributionText,
            pingedAt: record.pingedAt
          });
        }
      }
    }

    await setSagaStep(ledger, db, sagaId, 4, 'Rewrite deterministic provenance files from the asset record');
    const isPublished = download && commit;
    if (isPublished) {
      await ledger.updateAssetPublication(db, {
        assetId: asset.id,
        assetPath: placedAsset.relPath,
        rawAssetUrl: placedAsset.imageUrl
      });
    }

    await setSagaStep(ledger, db, sagaId, 5, 'Retry push if commit exists; otherwise re-run add and commit');
    if (commit) {
      await repo.gitPushAsset(repoPath, placedAsset.relPath, asset.slug);
    }

    await setSagaStep(ledger, db, sagaId, 6, 'Replace generated snippet for this placement instead of duplicating it');
    const snippetFormat = placement.snippetFormat || snippetFormatForTarget(placement.target);
    const snippet = buildSnippet({
      target: placement.target,
      imageUrl: placedAsset.imageUrl,
      displayName: asset.displayName,
      figureNumber: placement.figureNumber,
      caption: placement.caption || placement.draftLocation?.caption,
      attribution: asset.attribution,
      photographer: asset.photographer,
      license: asset.license
    });
    await ledger.updatePlacementSnippet(db, {
      placementId: placement.id,
      snippet,
      snippetFormat
    });
    if (writeSnippet) {
      await writeSnippet({ snippet, snippetFormat, asset, placement, placedAsset });
    }

    await setSagaStep(ledger, db, sagaId, 7, 'Recompute from repo state and draft snippet if ledger update fails');
    if (isPublished) {
      await ledger.markPlaced(db, {
        placementId: placement.id,
        assetId: asset.id,
        publishedUrl: placedAsset.imageUrl
      });
    }
    await ledger.markSagaStep(db, sagaId, {
      currentStep: 7,
      status: 'succeeded',
      resolution: 'auto-retry',
      compensation: null,
      lastError: null,
      nextRetryAt: null
    });

    return {
      asset,
      placement,
      placedAsset,
      snippet,
      snippetFormat
    };
  } catch (error) {
    await markFailedBestEffort(ledger, db, sagaId, error);
    throw error;
  }
}

async function setSagaStep(ledger, db, sagaId, currentStep, compensation) {
  await ledger.markSagaStep(db, sagaId, {
    currentStep,
    status: 'running',
    resolution: 'auto-retry',
    compensation,
    lastError: null
  });
}

async function markFailedBestEffort(ledger, db, sagaId, error) {
  try {
    await ledger.markFailed(db, {
      sagaId,
      error,
      resolution: 'manual-review'
    });
  } catch {
    // Preserve the original pipeline error.
  }
}

function normalizeAsset(asset = {}) {
  return {
    id: asset.id,
    assetType: asset.assetType || asset.asset_type,
    slug: asset.slug,
    displayName: asset.displayName || asset.display_name,
    sourceName: asset.sourceName || asset.source_name,
    sourcePath: asset.sourcePath || asset.source_path,
    sourceUrl: asset.sourceUrl || asset.source_url || asset.url,
    imageSrc: asset.imageSrc || asset.image_src,
    contentHash: asset.contentHash || asset.content_hash,
    photographer: asset.photographer,
    license: asset.license,
    attribution: asset.attribution,
    intakeSection: asset.intakeSection || asset.intake_section,
    assetPath: asset.assetPath || asset.asset_path,
    rawAssetUrl: asset.rawAssetUrl || asset.raw_asset_url,
    status: asset.status,
    thumbUrl: asset.thumbUrl || asset.thumb_url
  };
}

function normalizePlacement(placement = {}) {
  return {
    id: placement.id,
    assetId: placement.assetId || placement.asset_id,
    contentItemId: placement.contentItemId || placement.content_item_id,
    contentDraftId: placement.contentDraftId || placement.content_draft_id,
    target: placement.target,
    figureNumber: placement.figureNumber || placement.figure_number,
    draftLocation: placement.draftLocation || placement.draft_location_json,
    caption: placement.caption,
    snippet: placement.snippet,
    snippetFormat: placement.snippetFormat || placement.snippet_format,
    status: placement.status,
    publishedUrl: placement.publishedUrl || placement.published_url,
    series: placement.series,
    partDir: placement.partDir || placement.part_dir
  };
}

function resolveRepoPlacement(asset, placement, options) {
  const parsed = parseAssetPath(asset.assetPath);
  const intake = parseAssetPath(asset.intakeSection);
  const series = options.series || placement.series || parsed.series || intake.series || 'water-series';
  const partDir = options.partDir || placement.partDir || parsed.partDir || intake.partDir || asset.intakeSection;

  requireValue(partDir, 'partDir');
  return { series, partDir };
}

function parseAssetPath(assetPath) {
  const parts = String(assetPath || '').split('/').filter(Boolean);
  if (parts.length < 2) return {};
  return {
    series: parts[0],
    partDir: parts[1]
  };
}

function snippetFormatForTarget(target) {
  switch (target) {
    case 'substack':
      return 'html-figure';
    case 'carousel':
      return 'marp-image';
    case 'linkedin-post':
      return 'linkedin-handoff-text';
    default:
      return 'raw-url';
  }
}

function requireValue(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`placeAsset requires ${name}`);
  }
}

function isLocalSourceKind(sourceKind) {
  return sourceKind === 'downloads' || sourceKind === 'ai-generated' || sourceKind === 'user-provided';
}

module.exports = {
  placeAsset,
  snippetFormatForTarget,
  normalizeAsset,
  normalizePlacement
};
