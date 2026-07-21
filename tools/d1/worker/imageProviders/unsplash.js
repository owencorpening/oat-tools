'use strict';

const PROVIDER_ID = 'unsplash';
const PROVIDER_LABEL = 'Unsplash';
const LICENSE = 'Unsplash License';
const LICENSE_URL = 'https://unsplash.com/license';

function isEnabled(env = {}) {
  return Boolean(env.UNSPLASH_ACCESS_KEY);
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

  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('page', String(normalizedPage));
  url.searchParams.set('per_page', String(normalizedPerPage));
  url.searchParams.set('client_id', env.UNSPLASH_ACCESS_KEY);

  const data = await fetchJson(url.toString(), {}, env);
  const photos = Array.isArray(data && data.results) ? data.results : [];
  return {
    results: photos.map(normalizePhoto).filter(result => result.providerId && result.sourceUrl),
    page: normalizedPage,
    perPage: normalizedPerPage,
    totalResults: data && typeof data.total === 'number' ? data.total : photos.length,
    nextPage: data && data.total_pages && normalizedPage < data.total_pages ? normalizedPage + 1 : undefined
  };
}

async function resolve({ providerId, sourceUrl } = {}, env = {}) {
  const photoId = providerId || extractPhotoId(sourceUrl);
  if (!photoId || !isEnabled(env)) return {};

  const data = await fetchJson(
    `https://api.unsplash.com/photos/${encodeURIComponent(photoId)}?client_id=${encodeURIComponent(env.UNSPLASH_ACCESS_KEY)}`,
    {},
    env
  );
  return data ? normalizePhoto(data) : {};
}

function normalizePhoto(photo = {}) {
  const providerId = photo.id === undefined || photo.id === null ? '' : String(photo.id);
  const title = first(photo.alt_description, photo.description, providerId ? `Unsplash Photo ${providerId}` : 'Unsplash Photo');
  const sourceUrl = first(photo.links && photo.links.html);
  const photographer = first(photo.user && photo.user.name, 'UNKNOWN');

  return {
    provider: PROVIDER_ID,
    providerId,
    title,
    thumbnailUrl: first(photo.urls && photo.urls.small, photo.urls && photo.urls.thumb),
    imageSrc: first(photo.urls && photo.urls.regular, photo.urls && photo.urls.full, photo.urls && photo.urls.raw),
    sourceUrl,
    photographer,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    attribution: attributionFor({ title, photographer }),
    width: photo.width,
    height: photo.height,
    rawProviderRecord: photo
  };
}

function extractPhotoId(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    if (!/(^|\.)unsplash\.com$/i.test(parsed.hostname)) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const photosIndex = parts.indexOf('photos');
    if (photosIndex === -1 || !parts[photosIndex + 1]) return '';
    return parts[photosIndex + 1];
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
  return `Image: ${title}, by ${photographer}, Source: Unsplash. License: ${LICENSE}.`;
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
