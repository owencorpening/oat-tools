'use strict';

// Library of Congress: no API key, no ToS gate for the loc.gov JSON API
// (fo=json). The one real constraint is that rights metadata is NOT
// standardized across collections — LOC's own docs describe the data as
// "incredibly heterogeneous." There is no guaranteed rights field shape,
// so capability flags are only ever set when a result's `rights` text
// gives an explicit, confident public-domain-style signal; everything
// else is routed to needs-provenance for a human to check rather than
// guessed. Rate limit is 20 req/min with a 1hr block on violation — no
// key to throttle by, so keep requests modest (a human browsing/searching
// one query at a time, as this tool does, is well within that).
//
// KNOWN LIMITATION (verified in production, not theoretical): loc.gov is
// itself Cloudflare-fronted, and its WAF returns 403 to requests
// originating from Cloudflare Workers specifically — reproduced against
// both /search/ and /item/ with a proper browser User-Agent, so it's not
// a header issue. Direct curl from a non-Workers IP succeeds every time.
// This is an infrastructure-level block between Cloudflare zones that
// code changes here cannot route around. The implementation and tests
// are correct against LOC's actual response shape; it simply cannot
// reach loc.gov from this Worker today.
const PROVIDER_ID = 'loc';
const PROVIDER_LABEL = 'Library of Congress';
const PUBLIC_DOMAIN_PATTERN = /no known (copyright )?restriction|public domain|not protected by copyright/i;

function isEnabled() {
  return true;
}

function descriptor() {
  return { id: PROVIDER_ID, label: PROVIDER_LABEL };
}

async function search({ query, page = 1, perPage = 12 } = {}, env = {}) {
  const normalizedPage = normalizePositiveInt(page, 1);
  const normalizedPerPage = clamp(normalizePositiveInt(perPage, 12), 1, 150);
  if (!query) {
    return { results: [], page: normalizedPage, perPage: normalizedPerPage, totalResults: 0 };
  }

  // LOC's search endpoint mixes every format (books, newspapers, audio,
  // maps, photos, ...) into one relevance-ranked list — for a generic
  // term, most top hits often have no image_url at all. Over-fetch raw
  // rows and filter down, rather than requesting exactly perPage and
  // sometimes getting zero usable results back.
  const rawCount = clamp(Math.max(normalizedPerPage * 3, 25), 1, 150);
  const url = new URL('https://www.loc.gov/search/');
  url.searchParams.set('q', query);
  url.searchParams.set('fo', 'json');
  url.searchParams.set('sp', String(normalizedPage));
  url.searchParams.set('c', String(rawCount));

  const data = await fetchJson(url.toString(), env);
  const rows = Array.isArray(data && data.results) ? data.results : [];
  // Not every LOC result is an image (books, manuscripts, audio all share
  // this endpoint) — keep only rows that actually carry an image_url.
  const results = rows
    .filter(row => Array.isArray(row.image_url) && row.image_url.length > 0)
    .map(normalizePhoto)
    .filter(result => result.providerId && result.imageSrc)
    .slice(0, normalizedPerPage);

  return {
    results,
    page: normalizedPage,
    perPage: normalizedPerPage,
    totalResults: data && data.pagination && typeof data.pagination.of === 'number' ? data.pagination.of : results.length,
    // Approximate: with over-fetch + filtering, "next page" is a best-effort
    // continuation rather than an exact cursor — acceptable for a manual
    // search-and-browse tool, not a paginated bulk-export client.
    nextPage: data && data.pagination && data.pagination.next ? normalizedPage + 1 : undefined
  };
}

async function resolve({ providerId, sourceUrl } = {}, env = {}) {
  const id = providerId || extractPhotoId(sourceUrl);
  if (!id) return {};

  const itemUrl = /^https?:\/\//i.test(id) ? id : `https://www.loc.gov/item/${encodeURIComponent(id)}/`;
  const url = new URL(itemUrl);
  url.searchParams.set('fo', 'json');

  const data = await fetchJson(url.toString(), env);
  const item = data && (data.item || data);
  if (!item) return {};
  // Item responses nest under `item`; normalize to the same rough shape
  // search results use so normalizePhoto can handle either.
  return normalizePhoto({
    id: first(item.id, itemUrl),
    title: item.title,
    image_url: item.image_url,
    contributor: item.contributor,
    rights: item.rights,
    rights_advisory: item.rights_advisory,
    access_restricted: item.access_restricted
  });
}

function normalizePhoto(row = {}) {
  const sourceUrl = first(row.id, row.url);
  const providerId = extractPhotoId(sourceUrl) || sourceUrl || '';
  const images = Array.isArray(row.image_url) ? row.image_url : [];
  const title = first(row.title, providerId ? `Library of Congress Item ${providerId}` : 'Library of Congress Item');
  const photographer = first(Array.isArray(row.contributor) ? row.contributor[0] : row.contributor, 'Library of Congress');

  const rightsText = first(row.rights, Array.isArray(row.rights_advisory) ? row.rights_advisory.join(' ') : row.rights_advisory);
  const isConfidentlyPublicDomain = Boolean(rightsText && PUBLIC_DOMAIN_PATTERN.test(rightsText) && !row.access_restricted);

  return {
    provider: PROVIDER_ID,
    providerId,
    title,
    // LOC's image_url arrays are ordered lowest-to-highest resolution by
    // convention; not contractually guaranteed, so this is a best effort.
    thumbnailUrl: images[0],
    imageSrc: images[images.length - 1] || images[0],
    sourceUrl,
    photographer,
    license: isConfidentlyPublicDomain ? 'Public Domain' : first(rightsText, 'Rights not stated — needs review'),
    attribution: attributionFor({ title, photographer }),
    requiresAttribution: isConfidentlyPublicDomain ? false : undefined,
    allowsCommercialUse: isConfidentlyPublicDomain ? true : undefined,
    allowsModification: isConfidentlyPublicDomain ? true : undefined,
    needsReview: !isConfidentlyPublicDomain,
    rawProviderRecord: row
  };
}

function extractPhotoId(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    if (!/(^|\.)loc\.gov$/i.test(parsed.hostname)) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const itemIndex = parts.indexOf('item');
    return itemIndex !== -1 && parts[itemIndex + 1] ? parts[itemIndex + 1] : '';
  } catch {
    return '';
  }
}

async function fetchJson(url, env = {}) {
  const fetcher = env.fetch || globalThis.fetch;
  if (typeof fetcher !== 'function') return null;

  try {
    const response = await fetcher(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OAT-Image-Staging/1.0; +https://github.com/owencorpening/oat-tools)'
      }
    });
    if (!response || !response.ok) {
      // Surface non-2xx (in particular loc.gov's WAF 403 against Workers
      // traffic — see the file-level comment) without throwing; callers
      // treat "no data" and "blocked" the same way for now.
      if (response) console.log(`[loc provider] loc.gov returned ${response.status} for ${url}`);
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function attributionFor({ title, photographer }) {
  return `Image: ${title}, ${photographer}, Source: Library of Congress.`;
}

function first(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = {
  id: PROVIDER_ID,
  label: PROVIDER_LABEL,
  descriptor,
  isEnabled,
  search,
  resolve,
  normalizePhoto,
  extractPhotoId
};
