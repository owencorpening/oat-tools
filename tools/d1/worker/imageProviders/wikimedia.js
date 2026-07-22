'use strict';

// Wikimedia Commons uses the MediaWiki action API (action=query), not a
// REST-style search/resolve pair — search is a "generator" query that
// yields File-namespace pages, each annotated with imageinfo/extmetadata
// in the same response. No API key for read access, but the Wikimedia
// Foundation's API Usage Guidelines require a descriptive User-Agent with
// contact info on every request — this is enforced (bots without one get
// rate-limited or blocked), not just a courtesy, so every fetch below sets
// one. No other use-time obligation exists beyond that.
const PROVIDER_ID = 'wikimedia';
const PROVIDER_LABEL = 'Wikimedia Commons';
const API_URL = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'OAT-Image-Staging/1.0 (https://github.com/owencorpening/oat-tools)';

// extmetadata's LicenseShortName is free text ("CC BY-SA 4.0", "Public
// domain", "CC0 1.0", ...) with no separate machine-readable capability
// fields — infer from substrings. Commons' own docs warn extmetadata is
// "currently unreliable" for multi-licensed files, so anything we can't
// confidently classify is flagged for review rather than guessed.
function inferLicenseFlags(shortName) {
  const name = String(shortName || '').toLowerCase();
  if (!name) return { requiresAttribution: undefined, allowsCommercialUse: undefined, allowsModification: undefined, needsReview: true };
  if (name.includes('cc0') || name.includes('public domain') || name.includes('pdm')) {
    return { requiresAttribution: false, allowsCommercialUse: true, allowsModification: true, needsReview: false };
  }
  if (name.includes('cc') || name.includes('by')) {
    return {
      requiresAttribution: true,
      allowsCommercialUse: !name.includes('nc'),
      allowsModification: !name.includes('nd'),
      needsReview: false
    };
  }
  return { requiresAttribution: undefined, allowsCommercialUse: undefined, allowsModification: undefined, needsReview: true };
}

function isEnabled() {
  return true;
}

function descriptor() {
  return { id: PROVIDER_ID, label: PROVIDER_LABEL };
}

async function search({ query, page = 1, perPage = 12 } = {}, env = {}) {
  const normalizedPage = normalizePositiveInt(page, 1);
  const normalizedPerPage = clamp(normalizePositiveInt(perPage, 12), 1, 50);
  if (!query) {
    return { results: [], page: normalizedPage, perPage: normalizedPerPage, totalResults: 0 };
  }

  const url = new URL(API_URL);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', `filetype:bitmap ${query}`);
  url.searchParams.set('gsrnamespace', '6'); // File namespace
  url.searchParams.set('gsrlimit', String(normalizedPerPage));
  url.searchParams.set('gsroffset', String((normalizedPage - 1) * normalizedPerPage));
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|extmetadata|size');
  url.searchParams.set('iiurlwidth', '800');

  const data = await fetchJson(url.toString(), env);
  const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
  const results = pages.map(normalizePhoto).filter(result => result.providerId && result.sourceUrl);

  return {
    results,
    page: normalizedPage,
    perPage: normalizedPerPage,
    totalResults: results.length,
    nextPage: results.length === normalizedPerPage ? normalizedPage + 1 : undefined
  };
}

async function resolve({ providerId, sourceUrl } = {}, env = {}) {
  const id = providerId || extractPhotoId(sourceUrl);
  if (!id) return {};

  const url = new URL(API_URL);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  // Pageids from search results are numeric; ids parsed from pasted URLs
  // are titles ("File:Example.jpg") — MediaWiki takes either directly.
  if (/^\d+$/.test(id)) {
    url.searchParams.set('pageids', id);
  } else {
    url.searchParams.set('titles', id);
  }
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|extmetadata|size');
  url.searchParams.set('iiurlwidth', '800');

  const data = await fetchJson(url.toString(), env);
  const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
  const page = pages.find(p => !p.missing);
  return page ? normalizePhoto(page) : {};
}

function normalizePhoto(page = {}) {
  const providerId = page.pageid === undefined || page.pageid === null ? '' : String(page.pageid);
  const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
  const meta = (info && info.extmetadata) || {};
  const title = first(cleanTitle(page.title), providerId ? `Wikimedia Commons File ${providerId}` : 'Wikimedia Commons File');

  const licenseShortName = metaValue(meta, 'LicenseShortName');
  const flags = inferLicenseFlags(licenseShortName);
  // Prefer the page's own custom Attribution override; fall back to
  // Artist, then Credit (the source institution/uploader) — Commons
  // doesn't reliably separate photographer from uploader in all cases.
  const photographer = first(
    stripHtml(metaValue(meta, 'Attribution')),
    stripHtml(metaValue(meta, 'Artist')),
    stripHtml(metaValue(meta, 'Credit')),
    'UNKNOWN'
  );

  return {
    provider: PROVIDER_ID,
    providerId,
    title,
    thumbnailUrl: info && first(info.thumburl, info.url),
    imageSrc: info && info.url,
    sourceUrl: first(info && info.descriptionurl, page.title && `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`),
    photographer,
    license: first(licenseShortName, 'Unknown'),
    licenseUrl: metaValue(meta, 'LicenseUrl'),
    attribution: attributionFor({ title, photographer, license: licenseShortName }),
    requiresAttribution: flags.requiresAttribution,
    allowsCommercialUse: flags.allowsCommercialUse,
    allowsModification: flags.allowsModification,
    needsReview: flags.needsReview,
    width: info && info.width,
    height: info && info.height,
    rawProviderRecord: page
  };
}

function extractPhotoId(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    if (!/(^|\.)wikimedia\.org$/i.test(parsed.hostname)) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const wikiIndex = parts.indexOf('wiki');
    if (wikiIndex === -1 || !parts[wikiIndex + 1]) return '';
    return decodeURIComponent(parts[wikiIndex + 1]);
  } catch {
    return '';
  }
}

async function fetchJson(url, env = {}) {
  const fetcher = env.fetch || globalThis.fetch;
  if (typeof fetcher !== 'function') return null;

  try {
    const response = await fetcher(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response || !response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function metaValue(meta, key) {
  return meta && meta[key] && meta[key].value;
}

function stripHtml(value) {
  if (!value) return undefined;
  const text = String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function cleanTitle(title) {
  if (!title) return undefined;
  return String(title).replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '');
}

function attributionFor({ title, photographer, license }) {
  return `Image: ${title}, by ${photographer}, Source: Wikimedia Commons. License: ${license || 'see source'}.`;
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
