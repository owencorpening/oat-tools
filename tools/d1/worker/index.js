'use strict';

const ledger = require('../../../extensions/image-staging/lib/assetLedgerD1');
const { PROVIDERS, buildAttributionText } = require('./imageProviders');

async function fetch(request, env) {
  return handleRequest(request, env);
}

async function handleRequest(request, env = {}) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    requireDb(env);
    authorize(request, env);

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/image-providers') {
      return json(await handleListImageProviders(env));
    }
    if (request.method === 'GET' && url.pathname === '/image-providers/search') {
      return json(await handleSearchImageProviders(url, env));
    }
    if (request.method === 'POST' && url.pathname === '/assets') {
      return json(await handleCreateAsset(request, env.DB), 201);
    }
    if (request.method === 'POST' && url.pathname === '/captures/image') {
      return json(await handleCaptureImage(request, env), 201);
    }
    if (request.method === 'POST' && url.pathname === '/captures/provider-image') {
      return json(await handleCaptureProviderImage(request, env), 201);
    }
    if (request.method === 'POST' && url.pathname === '/review-image-needs') {
      return json(await handleCreateReviewImageNeed(request, env.DB), 201);
    }
    if (request.method === 'POST' && url.pathname === '/placements') {
      return json(await handleCreatePlacement(request, env.DB), 201);
    }
    const sagaStepMatch = url.pathname.match(/^\/sagas\/([^/]+)\/step$/);
    if (request.method === 'POST' && sagaStepMatch) {
      return json(await handleMarkSagaStep(request, env.DB, sagaStepMatch[1]));
    }
    const sagaFailedMatch = url.pathname.match(/^\/sagas\/([^/]+)\/failed$/);
    if (request.method === 'POST' && sagaFailedMatch) {
      return json(await handleMarkFailed(request, env.DB, sagaFailedMatch[1]));
    }
    const assetPublishingMatch = url.pathname.match(/^\/assets\/([^/]+)\/publishing$/);
    if (request.method === 'POST' && assetPublishingMatch) {
      return json(await handleMarkAssetPublishing(env.DB, assetPublishingMatch[1]));
    }
    const assetPublicationMatch = url.pathname.match(/^\/assets\/([^/]+)\/publication$/);
    if (request.method === 'POST' && assetPublicationMatch) {
      return json(await handleUpdateAssetPublication(request, env.DB, assetPublicationMatch[1]));
    }
    const assetDiscardedMatch = url.pathname.match(/^\/assets\/([^/]+)\/discarded$/);
    if (request.method === 'POST' && assetDiscardedMatch) {
      return json(await handleMarkAssetDiscarded(env.DB, assetDiscardedMatch[1]));
    }
    const assetRecordUseMatch = url.pathname.match(/^\/assets\/([^/]+)\/record-use$/);
    if (request.method === 'POST' && assetRecordUseMatch) {
      return json(await handleRecordAssetUse(env, assetRecordUseMatch[1]));
    }
    const placementPublishingMatch = url.pathname.match(/^\/placements\/([^/]+)\/publishing$/);
    if (request.method === 'POST' && placementPublishingMatch) {
      return json(await handleMarkPlacementPublishing(env.DB, placementPublishingMatch[1]));
    }
    const placementSnippetMatch = url.pathname.match(/^\/placements\/([^/]+)\/snippet$/);
    if (request.method === 'POST' && placementSnippetMatch) {
      return json(await handleUpdatePlacementSnippet(request, env.DB, placementSnippetMatch[1]));
    }
    const placementPlacedMatch = url.pathname.match(/^\/placements\/([^/]+)\/placed$/);
    if (request.method === 'POST' && placementPlacedMatch) {
      return json(await handleMarkPlaced(request, env.DB, placementPlacedMatch[1]));
    }
    if (request.method === 'GET' && url.pathname === '/image-needs/open') {
      return json({ imageNeeds: await ledger.listOpenNeeds(env.DB, { contentDraftId: url.searchParams.get('contentDraftId') || undefined }) });
    }
    if (request.method === 'GET' && url.pathname === '/assets/staged') {
      return json({ assets: await ledger.listStagedAssets(env.DB) });
    }
    if (request.method === 'GET' && url.pathname === '/assets') {
      return json({ assets: await ledger.listAssets(env.DB) });
    }
    if (request.method === 'GET' && url.pathname === '/placements/planned') {
      return json({ placements: await ledger.listPlannedPlacements(env.DB, { contentDraftId: url.searchParams.get('contentDraftId') || undefined }) });
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    const status = error.status || 500;
    return json({ error: error.message }, status);
  }
}

async function handleListImageProviders(env = {}) {
  const providers = [];
  for (const provider of Object.values(PROVIDERS)) {
    if (provider.isEnabled(env)) providers.push(provider.descriptor());
  }
  return { providers };
}

async function handleSearchImageProviders(url, env = {}) {
  const query = String(url.searchParams.get('q') || '').trim();
  if (!query) throw httpError(400, 'Missing q');

  const requestedProviders = providerList(url.searchParams.get('providers'));
  const page = url.searchParams.get('page') || 1;
  const perPage = url.searchParams.get('perPage') || url.searchParams.get('per_page') || 12;
  const providers = [];
  const results = [];

  for (const providerId of requestedProviders) {
    const provider = PROVIDERS[providerId];
    if (!provider || !provider.isEnabled(env)) continue;
    const providerResults = await provider.search({ query, page, perPage }, env);
    providers.push(provider.descriptor());
    results.push(...providerResults.results);
  }

  return { query, providers, results };
}

async function handleCaptureProviderImage(request, env = {}) {
  const body = await readJson(request);
  const asset = await normalizeProviderAsset(body, env);
  return { asset: await ledger.createAsset(env.DB, asset) };
}

async function handleMarkSagaStep(request, db, sagaId) {
  const body = await readJson(request);
  await ledger.markSagaStep(db, decodeURIComponent(sagaId), body || {});
  return { sagaId: decodeURIComponent(sagaId), ok: true };
}

async function handleMarkFailed(request, db, sagaId) {
  const body = await readJson(request);
  await ledger.markFailed(db, {
    sagaId: decodeURIComponent(sagaId),
    error: body && body.error,
    resolution: body && body.resolution,
    nextRetryAt: body && body.nextRetryAt
  });
  return { sagaId: decodeURIComponent(sagaId), ok: true };
}

async function handleMarkAssetPublishing(db, assetId) {
  await ledger.markAssetPublishing(db, decodeURIComponent(assetId));
  return { assetId: decodeURIComponent(assetId), ok: true };
}

async function handleUpdateAssetPublication(request, db, assetId) {
  const body = await readJson(request);
  await ledger.updateAssetPublication(db, {
    assetId: decodeURIComponent(assetId),
    assetPath: body && body.assetPath,
    rawAssetUrl: body && body.rawAssetUrl
  });
  return { assetId: decodeURIComponent(assetId), ok: true };
}

async function handleMarkAssetDiscarded(db, assetId) {
  await ledger.markAssetDiscarded(db, decodeURIComponent(assetId));
  return { assetId: decodeURIComponent(assetId), ok: true };
}

// Fetches the authoritative asset record from D1 (never trusts whatever the
// caller echoed back) and does two independent things at "this asset is
// actually being used now" time:
//   1. Provenance archival — hand back the raw API response, attribution,
//      and retrieval timestamp for any asset that has them, so the pipeline
//      can archive api_response.json etc. regardless of provider.
//   2. Provider-specific use-time obligations — currently only Unsplash's
//      download_location ping (API Guidelines require it be triggered on
//      use, not on browse/stage). Feature-detected via
//      providerImpl.pingDownloadLocation; a no-op for every other provider.
// A failed ping throws (502) and aborts — it's a compliance requirement,
// not a best-effort nicety. Missing provenance is not an error; most local/
// manually-intaken assets simply don't have any.
async function handleRecordAssetUse(env, assetId) {
  const id = decodeURIComponent(assetId);
  const asset = await ledger.getAsset(env.DB, id);
  if (!asset) throw httpError(404, 'Asset not found');

  const providerImpl = asset.provider && PROVIDERS[asset.provider];

  let pingPerformed = false;
  let pingedAt = null;
  if (providerImpl && providerImpl.pingDownloadLocation && asset.download_location) {
    const result = await providerImpl.pingDownloadLocation(asset.download_location, env);
    if (!result || !result.ok) {
      throw httpError(502, `${providerImpl.label} download_location ping failed`);
    }
    pingedAt = now();
    pingPerformed = true;
    await ledger.markDownloadLocationPinged(env.DB, { assetId: id, pingedAt });
  }

  const hasProvenance = Boolean(asset.raw_provider_record || asset.provider);

  return {
    assetId: id,
    hasProvenance,
    pingPerformed,
    pingedAt,
    provider: asset.provider,
    providerId: asset.provider_id,
    photographer: asset.photographer,
    photographerUrl: asset.photographer_url,
    retrievedAt: asset.retrieved_at,
    rawProviderRecord: parseJsonSafe(asset.raw_provider_record),
    // `attribution` is the provider's own citation-style string (used
    // elsewhere, e.g. carousel/on-page captions) — left untouched.
    // `attributionText` is what actually lands in attribution_text.txt:
    // one shared template, same shape regardless of provider. See
    // imageProviders/index.js -> buildAttributionText for why.
    attribution: asset.attribution,
    attributionText: providerImpl
      ? buildAttributionText({ photographer: asset.photographer, providerLabel: providerImpl.label })
      : undefined,
    license: asset.license,
    licenseUrl: asset.license_url,
    originalSource: asset.original_source,
    originalSourceUrl: asset.original_source_url
  };
}

function parseJsonSafe(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function now() {
  return new Date().toISOString();
}

async function handleMarkPlacementPublishing(db, placementId) {
  await ledger.markPlacementPublishing(db, decodeURIComponent(placementId));
  return { placementId: decodeURIComponent(placementId), ok: true };
}

async function handleUpdatePlacementSnippet(request, db, placementId) {
  const body = await readJson(request);
  await ledger.updatePlacementSnippet(db, {
    placementId: decodeURIComponent(placementId),
    snippet: body && body.snippet,
    snippetFormat: body && body.snippetFormat
  });
  return { placementId: decodeURIComponent(placementId), ok: true };
}

async function handleMarkPlaced(request, db, placementId) {
  const body = await readJson(request);
  await ledger.markPlaced(db, {
    placementId: decodeURIComponent(placementId),
    assetId: body && body.assetId,
    publishedUrl: body && body.publishedUrl
  });
  return { placementId: decodeURIComponent(placementId), ok: true };
}

async function handleCreateAsset(request, db) {
  const body = await readJson(request);
  if (!body.asset) throw httpError(400, 'Missing asset');
  const asset = await ledger.createAsset(db, body.asset);
  return { asset };
}

async function handleCaptureImage(request, env) {
  const body = await readJson(request);
  const asset = await normalizeCapturedAsset(body, env);
  return { asset: await ledger.createAsset(env.DB, asset) };
}

async function normalizeProviderAsset(input = {}, env = {}) {
  const result = input.result || input;
  const provider = first(input.provider, result.provider);
  const providerImpl = provider && PROVIDERS[provider];
  if (!providerImpl || !providerImpl.isEnabled(env)) throw httpError(400, 'Unsupported provider');

  const providerId = first(input.providerId, input.id, result.providerId);
  const resolved = await providerImpl.resolve({
    providerId,
    sourceUrl: first(input.sourceUrl, result.sourceUrl)
  }, env);
  const normalized = {
    ...result,
    ...resolved,
    provider,
    providerId: first(resolved.providerId, providerId, result.providerId)
  };

  const sourceUrl = first(normalized.sourceUrl, input.sourceUrl);
  const imageSrc = first(normalized.imageSrc, input.imageSrc);
  const photographer = first(normalized.photographer, input.photographer, 'UNKNOWN');
  const license = first(input.license, normalized.license, licenseForSource(sourceUrl));
  const displayName = first(input.displayName, normalized.title, titleFromUrl(sourceUrl));
  if (!sourceUrl) throw httpError(400, 'Missing sourceUrl');

  return {
    id: first(input.assetId, newAssetId()),
    assetType: 'image',
    slug: first(input.slug, slugFromName(displayName)),
    displayName,
    sourceName: first(input.sourceName, `${normalized.provider}:${normalized.providerId}`, displayName),
    sourceUrl,
    imageSrc,
    photographer,
    license,
    attribution: first(input.attribution, normalized.attribution, attributionFor({
      displayName,
      photographer,
      sourceUrl,
      license
    })),
    intakeSection: emptyToUndefined(input.intakeSection),
    // Sources with unreliable/inconsistent rights metadata (Library of
    // Congress in particular) route to needs-provenance instead of staged —
    // a human has to confirm usage rights before this is placement-ready.
    status: normalized.needsReview ? 'needs-provenance' : 'staged',
    provider: normalized.provider,
    providerId: normalized.providerId,
    photographerUrl: normalized.photographerUrl,
    downloadLocation: normalized.downloadLocation,
    retrievedAt: now(),
    rawProviderRecord: normalized.rawProviderRecord,
    licenseUrl: normalized.licenseUrl,
    requiresAttribution: normalized.requiresAttribution,
    allowsCommercialUse: normalized.allowsCommercialUse,
    allowsModification: normalized.allowsModification,
    originalSource: normalized.originalSource,
    originalSourceUrl: normalized.originalSourceUrl
  };
}

async function normalizeCapturedAsset(input = {}, env = {}) {
  const sourceUrl = first(input.sourceUrl, input.url);
  if (!sourceUrl) throw httpError(400, 'Missing sourceUrl');

  const metadata = await resolveCapturedMetadata(sourceUrl, env);
  const displayName = first(input.displayName, input.name, input.pageTitle, titleFromUrl(sourceUrl));
  const photographer = first(metadata.photographer, input.photographer, 'UNKNOWN');
  const license = first(input.license, metadata.license, licenseForSource(sourceUrl));
  const imageSrc = first(input.imageSrc, input.image_src, metadata.imageSrc);

  return {
    id: first(input.id, newAssetId()),
    assetType: first(input.assetType, 'image'),
    slug: first(input.slug, slugFromName(displayName)),
    displayName,
    sourceName: first(input.sourceName, input.name, displayName),
    sourceUrl,
    imageSrc,
    photographer,
    license,
    attribution: first(input.attribution, attributionFor({ displayName, photographer, sourceUrl, license })),
    intakeSection: emptyToUndefined(input.intakeSection),
    status: first(input.status, capturedStatus({ sourceUrl, photographer, license }))
  };
}

function capturedStatus(asset) {
  return asset.sourceUrl ? 'staged' : 'needs-provenance';
}

function licenseForSource(sourceUrl) {
  if (/pexels\.com|pixabay\.com|unsplash\.com/i.test(sourceUrl)) {
    return 'CC0 Equivalent (No Attribution)';
  }
  return 'MANUAL CHECK REQUIRED';
}

function attributionFor({ displayName, photographer, sourceUrl, license }) {
  return `Image: ${displayName}, by ${photographer}, Source: ${sourceDomain(sourceUrl)}. License: ${license}.`;
}

function sourceDomain(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return sourceUrl;
  }
}

async function resolveCapturedMetadata(sourceUrl, env = {}) {
  // Try every provider that knows how to parse its own URLs back to an id —
  // a new provider gets URL-paste intake for free just by implementing
  // extractPhotoId, no hardcoded list to maintain here.
  for (const provider of Object.values(PROVIDERS)) {
    if (typeof provider.extractPhotoId !== 'function' || !provider.isEnabled(env)) continue;
    const id = provider.extractPhotoId(sourceUrl);
    if (id) return provider.resolve({ providerId: id }, env);
  }

  return {};
}

async function handleCreateReviewImageNeed(request, db) {
  const body = await readJson(request);
  if (!body.contentDraft) throw httpError(400, 'Missing contentDraft');
  if (!body.imageNeed) throw httpError(400, 'Missing imageNeed');

  await upsertContentDraft(db, body.contentDraft);
  const imageNeed = await ledger.createImageNeed(db, body.imageNeed);
  return { contentDraft: body.contentDraft, imageNeed };
}

async function handleCreatePlacement(request, db) {
  const body = await readJson(request);
  if (!body.placement) throw httpError(400, 'Missing placement');

  if (body.contentDraft) {
    await upsertContentDraft(db, body.contentDraft);
  }

  const placement = await ledger.createPlacement(db, body.placement);
  let saga = null;
  if (body.saga) {
    saga = await ledger.createSaga(db, {
      ...body.saga,
      assetId: body.saga.assetId || body.placement.assetId,
      assetPlacementId: body.saga.assetPlacementId || body.placement.id
    });
  }

  return { placement, saga };
}

async function upsertContentDraft(db, draft) {
  await db.prepare(`
    INSERT INTO content_draft (
      id,
      content_item_id,
      content_repo_path,
      draft_path,
      title,
      heading_anchor,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content_item_id = excluded.content_item_id,
      content_repo_path = excluded.content_repo_path,
      draft_path = excluded.draft_path,
      title = excluded.title,
      heading_anchor = excluded.heading_anchor,
      status = excluded.status,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(
    draft.id,
    draft.contentItemId || null,
    draft.contentRepoPath || null,
    draft.draftPath,
    draft.title || null,
    draft.headingAnchor || null,
    draft.status || 'active'
  ).run();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, 'Invalid JSON body');
  }
}

function requireDb(env) {
  if (!env.DB) throw httpError(500, 'Missing D1 DB binding');
}

function authorize(request, env) {
  if (!env.LEDGER_API_TOKEN) return;
  const expected = `Bearer ${env.LEDGER_API_TOKEN}`;
  if (request.headers.get('authorization') !== expected) {
    throw httpError(401, 'Unauthorized');
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json'
    }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function newAssetId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `asset-${globalThis.crypto.randomUUID()}`;
  }
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function slugFromName(name = '') {
  return String(name || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'captured-image';
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    return humanize(lastSegment || parsed.hostname);
  } catch {
    return 'Captured image';
  }
}

function humanize(value = '') {
  return String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, c => c.toUpperCase()) || 'Captured image';
}

function first(...values) {
  for (const value of values) {
    const clean = emptyToUndefined(value);
    if (clean !== undefined) return clean;
  }
  return undefined;
}

function providerList(value) {
  const providers = String(value || 'pexels')
    .split(',')
    .map(provider => provider.trim().toLowerCase())
    .filter(Boolean);
  return providers.length === 0 ? ['pexels'] : providers;
}

function emptyToUndefined(value) {
  if (value === undefined || value === null) return undefined;
  const clean = String(value).trim();
  return clean === '' ? undefined : clean;
}

module.exports = {
  fetch,
  handleRequest,
  handleListImageProviders,
  handleSearchImageProviders,
  handleCreateAsset,
  handleCaptureImage,
  handleCaptureProviderImage,
  normalizeProviderAsset,
  normalizeCapturedAsset,
  handleCreateReviewImageNeed,
  handleCreatePlacement,
  handleMarkSagaStep,
  handleMarkFailed,
  handleMarkAssetPublishing,
  handleUpdateAssetPublication,
  handleMarkAssetDiscarded,
  handleMarkPlacementPublishing,
  handleUpdatePlacementSnippet,
  handleMarkPlaced,
  upsertContentDraft
};
