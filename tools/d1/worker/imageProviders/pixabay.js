'use strict';

// Pixabay Content License (https://pixabay.com/service/license/): free for
// commercial and non-commercial use, modification allowed, attribution not
// legally required (we attribute anyway per our own convention). Beyond
// the license itself, Pixabay's API terms ask that content not be
// hotlinked (we download and re-host, so this is already satisfied) and
// that results be cached rather than re-fetched on every request — no
// use-time ping or similar obligation exists.
const PROVIDER_ID = 'pixabay';
const PROVIDER_LABEL = 'Pixabay';
const LICENSE = 'Pixabay Content License';
const LICENSE_URL = 'https://pixabay.com/service/license/';

function isEnabled(env = {}) {
  return Boolean(env.PIXABAY_API_KEY);
}

function descriptor() {
  return { id: PROVIDER_ID, label: PROVIDER_LABEL };
}

async function search({ query, page = 1, perPage = 12 } = {}, env = {}) {
  const normalizedPage = normalizePositiveInt(page, 1);
  // Pixabay's own minimum is 3, not 1.
  const normalizedPerPage = clamp(normalizePositiveInt(perPage, 12), 3, 200);
  if (!query || !isEnabled(env)) {
    return { results: [], page: normalizedPage, perPage: normalizedPerPage, totalResults: 0 };
  }

  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', env.PIXABAY_API_KEY);
  url.searchParams.set('q', query);
  url.searchParams.set('page', String(normalizedPage));
  url.searchParams.set('per_page', String(normalizedPerPage));
  url.searchParams.set('image_type', 'photo');

  const data = await fetchJson(url.toString(), {}, env);
  const hits = Array.isArray(data && data.hits) ? data.hits : [];
  return {
    results: hits.map(normalizePhoto).filter(result => result.providerId && result.sourceUrl),
    page: normalizedPage,
    perPage: normalizedPerPage,
    totalResults: data && typeof data.totalHits === 'number' ? data.totalHits : hits.length,
    nextPage: data && typeof data.totalHits === 'number' && normalizedPage * normalizedPerPage < data.totalHits
      ? normalizedPage + 1
      : undefined
  };
}

async function resolve({ providerId, sourceUrl } = {}, env = {}) {
  const photoId = providerId || extractPhotoId(sourceUrl);
  if (!photoId || !isEnabled(env)) return {};

  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', env.PIXABAY_API_KEY);
  url.searchParams.set('id', photoId);

  const data = await fetchJson(url.toString(), {}, env);
  const hit = data && Array.isArray(data.hits) ? data.hits[0] : null;
  return hit ? normalizePhoto(hit) : {};
}

function normalizePhoto(photo = {}) {
  const providerId = photo.id === undefined || photo.id === null ? '' : String(photo.id);
  const title = first(cleanTags(photo.tags), providerId ? `Pixabay Photo ${providerId}` : 'Pixabay Photo');
  const photographer = first(photo.user, 'UNKNOWN');
  const photographerUrl = photo.user && photo.user_id
    ? `https://pixabay.com/users/${encodeURIComponent(photo.user)}-${encodeURIComponent(photo.user_id)}/`
    : undefined;

  return {
    provider: PROVIDER_ID,
    providerId,
    title,
    thumbnailUrl: first(photo.webformatURL, photo.previewURL),
    imageSrc: first(photo.largeImageURL, photo.webformatURL),
    sourceUrl: first(photo.pageURL),
    photographer,
    photographerUrl,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    attribution: attributionFor({ title, photographer }),
    requiresAttribution: false,
    allowsCommercialUse: true,
    allowsModification: true,
    width: photo.imageWidth,
    height: photo.imageHeight,
    rawProviderRecord: photo
  };
}

function extractPhotoId(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    if (!/(^|\.)pixabay\.com$/i.test(parsed.hostname)) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    const idMatch = last.match(/(\d+)$/);
    return idMatch ? idMatch[1] : '';
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

function attributionFor({ title, photographer }) {
  return `Image: ${title}, by ${photographer}, Source: Pixabay. License: ${LICENSE}.`;
}

function cleanTags(tags) {
  if (!tags) return undefined;
  const first = String(tags).split(',')[0].trim();
  return first || undefined;
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
