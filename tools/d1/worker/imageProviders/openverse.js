'use strict';

// Openverse aggregates CC-licensed/public-domain content indexed from many
// upstream sources (Flickr, Wikimedia, museums, etc.) — the license on each
// item is whatever the ORIGINAL source claims, not something Openverse
// itself verifies. We record that distinction explicitly: `provider`
// always stays "openverse" (the API we queried); `originalSource` /
// `originalSourceUrl` carry the true upstream chain.
//
// No API key required for anonymous read access; optional OAuth2
// client_credentials unlocks a higher rate-limit tier (not implemented
// here — anonymous access is sufficient for this use case). No attribution
// obligation beyond each item's own license, and no separate Openverse API
// usage requirement beyond disclosing "made using the Openverse API" at
// the application level (already true of this tool as a whole).
const PROVIDER_ID = 'openverse';
const PROVIDER_LABEL = 'Openverse';
const BASE_URL = 'https://api.openverse.org/v1/images/';

// Standard CC license matrix — definitional, not something that changes.
// PDM (Public Domain Mark) behaves like CC0 for usage purposes.
const LICENSE_INFO = {
  cc0: { name: 'CC0', requiresAttribution: false, allowsCommercialUse: true, allowsModification: true },
  pdm: { name: 'Public Domain Mark', requiresAttribution: false, allowsCommercialUse: true, allowsModification: true },
  by: { name: 'CC BY', requiresAttribution: true, allowsCommercialUse: true, allowsModification: true },
  'by-sa': { name: 'CC BY-SA', requiresAttribution: true, allowsCommercialUse: true, allowsModification: true },
  'by-nd': { name: 'CC BY-ND', requiresAttribution: true, allowsCommercialUse: true, allowsModification: false },
  'by-nc': { name: 'CC BY-NC', requiresAttribution: true, allowsCommercialUse: false, allowsModification: true },
  'by-nc-sa': { name: 'CC BY-NC-SA', requiresAttribution: true, allowsCommercialUse: false, allowsModification: true },
  'by-nc-nd': { name: 'CC BY-NC-ND', requiresAttribution: true, allowsCommercialUse: false, allowsModification: false }
};

// OAT publishes commercially — never surface licenses that forbid it.
// Enforced both server-side (license_type param) and again client-side
// on the results, so a future change in the API's filtering behavior
// can't silently let an NC/ND item through.
const ALLOWED_LICENSE_TYPES = 'commercial,modification';

function isEnabled() {
  return true;
}

function descriptor() {
  return { id: PROVIDER_ID, label: PROVIDER_LABEL };
}

async function search({ query, page = 1, perPage = 12 } = {}, env = {}) {
  const normalizedPage = normalizePositiveInt(page, 1);
  const normalizedPerPage = clamp(normalizePositiveInt(perPage, 12), 1, 20);
  if (!query) {
    return { results: [], page: normalizedPage, perPage: normalizedPerPage, totalResults: 0 };
  }

  const url = new URL(BASE_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('page', String(normalizedPage));
  url.searchParams.set('page_size', String(normalizedPerPage));
  url.searchParams.set('license_type', ALLOWED_LICENSE_TYPES);

  const data = await fetchJson(url.toString(), {}, env);
  const photos = Array.isArray(data && data.results) ? data.results : [];
  const results = photos
    .map(normalizePhoto)
    .filter(result => result.providerId && result.sourceUrl
      && result.allowsCommercialUse !== false && result.allowsModification !== false);

  return {
    results,
    page: normalizedPage,
    perPage: normalizedPerPage,
    totalResults: data && typeof data.result_count === 'number' ? data.result_count : results.length,
    nextPage: data && data.page_count && normalizedPage < data.page_count ? normalizedPage + 1 : undefined
  };
}

async function resolve({ providerId, sourceUrl } = {}, env = {}) {
  const photoId = providerId || extractPhotoId(sourceUrl);
  if (!photoId) return {};

  const data = await fetchJson(`${BASE_URL}${encodeURIComponent(photoId)}/`, {}, env);
  return data ? normalizePhoto(data) : {};
}

function normalizePhoto(photo = {}) {
  const providerId = photo.id === undefined || photo.id === null ? '' : String(photo.id);
  const licenseCode = String(photo.license || '').toLowerCase();
  const licenseInfo = LICENSE_INFO[licenseCode];
  const title = first(photo.title, providerId ? `Openverse Photo ${providerId}` : 'Openverse Photo');
  const photographer = first(photo.creator, 'UNKNOWN');

  return {
    provider: PROVIDER_ID,
    providerId,
    title,
    thumbnailUrl: first(photo.thumbnail, photo.url),
    imageSrc: first(photo.url),
    sourceUrl: first(photo.foreign_landing_url),
    photographer,
    photographerUrl: first(photo.creator_url),
    license: licenseInfo ? licenseInfo.name : first(photo.license, 'Unknown'),
    licenseUrl: first(photo.license_url),
    // Openverse pre-formats a correct attribution string per item; prefer
    // it over building our own, since it already accounts for the
    // upstream source's specific requirements.
    attribution: first(photo.attribution, attributionFor({ title, photographer, licenseName: licenseInfo && licenseInfo.name })),
    requiresAttribution: licenseInfo ? licenseInfo.requiresAttribution : undefined,
    allowsCommercialUse: licenseInfo ? licenseInfo.allowsCommercialUse : undefined,
    allowsModification: licenseInfo ? licenseInfo.allowsModification : undefined,
    // Upstream provenance, distinct from "openverse" as the provider we
    // actually queried — this is the true creator -> host chain.
    originalSource: first(photo.source),
    originalSourceUrl: first(photo.foreign_landing_url),
    width: photo.width,
    height: photo.height,
    rawProviderRecord: photo
  };
}

function extractPhotoId(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    if (!/(^|\.)openverse\.org$/i.test(parsed.hostname)) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const imageIndex = parts.indexOf('image');
    return imageIndex !== -1 && parts[imageIndex + 1] ? parts[imageIndex + 1] : '';
  } catch {
    return '';
  }
}

async function fetchJson(url, init, env = {}) {
  const fetcher = env.fetch || globalThis.fetch;
  if (typeof fetcher !== 'function') return null;

  try {
    const response = await fetcher(url, init);
    if (!response || !response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function attributionFor({ title, photographer, licenseName }) {
  return `Image: ${title}, by ${photographer}, via Openverse. License: ${licenseName || 'see source'}.`;
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
