'use strict';

// Engine 1 — stock search & auto-insert. Reuses the existing D1-backed
// provider search (ledgerWriter.searchImageProviders -> Worker's
// GET /image-providers/search) rather than rebuilding search — this file
// only adds the "is it safe to auto-insert without asking a human"
// decision Sweep needs and Review's webview-free flow doesn't.

// Every provider's normalizePhoto() already computes this pair as
// true/false/undefined ('undefined' is the provider's own "couldn't
// confidently classify this" signal — e.g. Wikimedia/LOC's needsReview
// path). Strict equality naturally treats undefined as unsafe with zero
// extra state. requiresAttribution is deliberately NOT part of the gate:
// placeAsset() already writes attribution files automatically, so
// mandatory-but-mechanical attribution doesn't need a human — what needs
// one is legal risk (commercial/derivative-use restriction or ambiguous
// rights), not paperwork.
function isAutoInsertSafe(result) {
  return Boolean(result) && result.allowsCommercialUse === true && result.allowsModification === true;
}

async function searchStock({ query, ledgerWriter, providers } = {}) {
  const response = await ledgerWriter.searchImageProviders({ query, providers });
  return (response && response.results) || [];
}

// Headless: search, filter to auto-insert-safe, take the first (provider's
// own relevance ordering, not re-ranked) — never take literal results[0]
// without filtering first. Empty safe list means "no stock match," which
// is the caller's cue to fall to Engine 2.
async function attemptAutoResolve({ query, ledgerWriter, providers, search = searchStock } = {}) {
  const results = await search({ query, ledgerWriter, providers });
  const safe = results.filter(isAutoInsertSafe);
  return safe.length > 0 ? safe[0] : null;
}

// Stages a resolved search result into a real D1 asset row (same payload
// shape as ImagePanelProvider's own _handleStageProviderImage) — returns
// the ledger's { asset } response, which is what buildDraftsmanPlacement
// needs (a real asset.id).
async function stageResult({ ledgerWriter, result } = {}) {
  return ledgerWriter.stageProviderImage({
    provider: result.provider,
    providerId: result.providerId,
    sourceUrl: result.sourceUrl,
    result
  });
}

module.exports = { isAutoInsertSafe, searchStock, attemptAutoResolve, stageResult };
