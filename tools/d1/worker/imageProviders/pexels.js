'use strict';

const PROVIDER_ID = 'pexels';
const PROVIDER_LABEL = 'Pexels';
const LICENSE = 'Pexels License';
const LICENSE_URL = 'https://www.pexels.com/license/';

function isEnabled(env = {}) {
  return Boolean(env.PEXELS_ACCESS_KEY);
}

function descriptor() {
  return { id: PROVIDER_ID, label: PROVIDER_LABEL };
}

async function search({ query, page = 1, perPage = 12 } = {}, env = {}) {
  const normalizedPage = normalizePositiveInt(page, 1);
  const normalizedPerPage = clamp(normalizePositiveInt(perPage, 12), 1, 20);
  if (!query || !isEnabled(env)) {
    return { results: [], page: normalizedPage, perPage: normalizedPerPage, totalResults: 0 };
  }

  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('page', String(normalizedPage));
  url.searchParams.set('per_page', String(normalizedPerPage));

  const data = await fetchJson(url.toString(), pexelsInit(env), env);
  const photos = Array.isArray(data && data.photos) ? data.photos : [];
  return {
    results: photos.map(normalizePhoto).filter(result => result.providerId && result.sourceUrl),
    page: data && data.page ? data.page : normalizedPage,
    perPage: data && data.per_page ? data.per_page : normalizedPerPage,
    totalResults: data && data.total_results ? data.total_results : photos.length,
    nextPage: data && data.next_page
  };
}

async function resolve({ providerId, sourceUrl } = {}, env = {}) {
  const photoId = providerId || extractPhotoId(sourceUrl);
  if (!photoId || !isEnabled(env)) return {};

  const data = await fetchJson(
    `https://api.pexels.com/v1/photos/${encodeURIComponent(photoId)}`,
    pexelsInit(env),
    env
  );
  return data ? normalizePhoto(data) : {};
}

function normalizePhoto(photo = {}) {
  const providerId = photo.id === undefined || photo.id === null ? '' : String(photo.id);
  const title = first(photo.alt, providerId ? `Pexels Photo ${providerId}` : 'Pexels Photo');
  const sourceUrl = first(photo.url);
  const photographer = first(photo.photographer, 'UNKNOWN');

  return {
    provider: PROVIDER_ID,
    providerId,
    title,
    thumbnailUrl: first(photo.src && photo.src.medium, photo.src && photo.src.small),
    imageSrc: first(photo.src && photo.src.large2x, photo.src && photo.src.large, photo.src && photo.src.original),
    sourceUrl,
    photographer,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    attribution: attributionFor({ title, photographer }),
    requiresAttribution: false,
    allowsCommercialUse: true,
    allowsModification: true,
    width: photo.width,
    height: photo.height,
    rawProviderRecord: photo
  };
}

function extractPhotoId(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    if (!/(^|\.)pexels\.com$/i.test(parsed.hostname)) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const photoIndex = parts.indexOf('photo');
    const slug = photoIndex === -1 ? parts[parts.length - 1] : parts[photoIndex + 1];
    const idMatch = String(slug || '').match(/(\d+)$/);
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

function pexelsInit(env = {}) {
  return { headers: { Authorization: env.PEXELS_ACCESS_KEY } };
}

function attributionFor({ title, photographer }) {
  return `Image: ${title}, by ${photographer}, Source: Pexels. License: ${LICENSE}.`;
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
