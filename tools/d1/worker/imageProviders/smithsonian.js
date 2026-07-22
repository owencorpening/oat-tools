'use strict';

// Smithsonian Open Access is, by construction, CC0-only: a record only
// appears in this dataset because content.descriptiveNonRepeating.usage.
// access is "CC0" — there is no other license value in this API. No
// attribution obligation exists, and there's no use-time obligation
// beyond the license itself (no ping, no "cite this way" requirement).
const PROVIDER_ID = 'smithsonian';
const PROVIDER_LABEL = 'Smithsonian Open Access';
const LICENSE = 'CC0';
const LICENSE_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';
const BASE_URL = 'https://api.si.edu/openaccess/api/v1.0';

function isEnabled(env = {}) {
  return Boolean(env.SMITHSONIAN_API_KEY);
}

function descriptor() {
  return { id: PROVIDER_ID, label: PROVIDER_LABEL };
}

async function search({ query, page = 1, perPage = 12 } = {}, env = {}) {
  const normalizedPage = normalizePositiveInt(page, 1);
  const normalizedPerPage = clamp(normalizePositiveInt(perPage, 12), 1, 50);
  if (!query || !isEnabled(env)) {
    return { results: [], page: normalizedPage, perPage: normalizedPerPage, totalResults: 0 };
  }

  const url = new URL(`${BASE_URL}/search`);
  url.searchParams.set('api_key', env.SMITHSONIAN_API_KEY);
  url.searchParams.set('q', `online_media_type:Images AND ${query}`);
  url.searchParams.set('rows', String(normalizedPerPage));
  url.searchParams.set('start', String((normalizedPage - 1) * normalizedPerPage));

  const data = await fetchJson(url.toString(), env);
  const rows = data && data.response && Array.isArray(data.response.rows) ? data.response.rows : [];
  const results = rows.map(normalizePhoto).filter(result => result.providerId && result.imageSrc);

  return {
    results,
    page: normalizedPage,
    perPage: normalizedPerPage,
    totalResults: data && data.response && typeof data.response.rowCount === 'number' ? data.response.rowCount : results.length,
    nextPage: results.length === normalizedPerPage ? normalizedPage + 1 : undefined
  };
}

async function resolve({ providerId } = {}, env = {}) {
  if (!providerId || !isEnabled(env)) return {};

  const url = new URL(`${BASE_URL}/content/${encodeURIComponent(providerId)}`);
  url.searchParams.set('api_key', env.SMITHSONIAN_API_KEY);

  const data = await fetchJson(url.toString(), env);
  const row = data && data.response;
  return row ? normalizePhoto(row) : {};
}

function normalizePhoto(row = {}) {
  const providerId = first(row.id, '');
  const descriptive = (row.content && row.content.descriptiveNonRepeating) || {};
  const freetext = (row.content && row.content.freetext) || {};
  const media = descriptive.online_media && Array.isArray(descriptive.online_media.media)
    ? descriptive.online_media.media
    : [];
  const image = media.find(m => m.type === 'Images') || media[0] || {};

  const title = first(row.title, providerId ? `Smithsonian Object ${providerId}` : 'Smithsonian Object');
  const photographer = first(creditLine(freetext), unitName(descriptive), 'Smithsonian Institution');

  return {
    provider: PROVIDER_ID,
    providerId,
    title,
    thumbnailUrl: first(image.thumbnail, image.content),
    imageSrc: first(image.content),
    sourceUrl: first(descriptive.record_link, descriptive.guid),
    photographer,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    attribution: attributionFor({ title, photographer }),
    requiresAttribution: false,
    allowsCommercialUse: true,
    allowsModification: true,
    rawProviderRecord: row
  };
}

// Smithsonian's freetext.name entries carry a mix of roles (photographer,
// artist, maker, publisher, ...) with no single canonical "creator" field
// — take the first one whose label looks like an authorship credit.
function creditLine(freetext) {
  const names = Array.isArray(freetext.name) ? freetext.name : [];
  const credited = names.find(entry => /photographer|artist|creator|maker/i.test(entry && entry.label));
  return credited && credited.content;
}

function unitName(descriptive) {
  return descriptive.unit_code;
}

async function fetchJson(url, env = {}) {
  const fetcher = env.fetch || globalThis.fetch;
  if (typeof fetcher !== 'function') return null;

  try {
    const response = await fetcher(url, {});
    if (!response || !response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function attributionFor({ title, photographer }) {
  return `Image: ${title}, by ${photographer}, Source: Smithsonian Open Access. License: ${LICENSE}.`;
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
  normalizePhoto
};
