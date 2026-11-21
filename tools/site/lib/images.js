'use strict';

// Copies every image a published article uses into the site output, and
// points the page at the copy. Only images found in published article HTML
// are fetched. A failed download stops the build.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif'
};

function imageSources(html) {
  const out = [];
  const re = /<img\b[^>]*\bsrc="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/&amp;/g, '&'));
  return out;
}

// GitHub's raw file host limits requests from shared CI machines. With a
// token (set OAT_GITHUB_TOKEN in CI) the limit is much higher. The token is
// sent to that host only.
function requestOptions(url) {
  const opts = { redirect: 'follow', headers: { 'user-agent': 'oat-site-build' } };
  const token = process.env.OAT_GITHUB_TOKEN;
  if (token && new URL(url).hostname === 'raw.githubusercontent.com') {
    opts.headers.authorization = `token ${token}`;
  }
  return opts;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [2000, 8000, 20000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries busy or rate-limited answers (429, 5xx) and network errors a few
// times before failing. A 404 fails at once.
async function downloadImage(url, fetchImpl, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS) {
  let res;
  for (let attempt = 0; ; attempt += 1) {
    let failure;
    try {
      res = await fetchImpl(url, requestOptions(url));
      if (!RETRY_STATUS.has(res.status)) break;
      const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 120);
      failure = `HTTP ${res.status}${detail ? ` (${detail})` : ''}`;
    } catch (err) {
      failure = err.cause ? err.cause.message : err.message;
    }
    if (attempt >= retryDelaysMs.length) {
      throw new Error(`image ${url}: ${failure} after ${attempt + 1} tries`);
    }
    await sleep(retryDelaysMs[attempt]);
  }
  if (!res.ok) throw new Error(`image ${url}: HTTP ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type];
  if (!ext) throw new Error(`image ${url}: unexpected content type "${type || 'none'}"`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const name = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)}${ext}`;
  return { name, bytes };
}

// pages: [{ html }]; returns a Map of original URL -> "assets/<file>".
async function copyImages(pages, outDir, fetchImpl = fetch, retryDelaysMs) {
  const urls = new Set();
  for (const p of pages) for (const src of imageSources(p.html)) urls.add(src);

  const map = new Map();
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`image ${url}: only full http(s) image URLs are supported`);
    }
    const { name, bytes } = await downloadImage(url, fetchImpl, retryDelaysMs);
    const dest = path.join(outDir, 'assets', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    map.set(url, `assets/${name}`);
  }
  return map;
}

// Rewrites <img src> in one page; `rootPrefix` is "../../" etc.
function pointAtCopies(html, map, rootPrefix) {
  return html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (all, a, src, b) => {
    const local = map.get(src.replace(/&amp;/g, '&'));
    return local ? `${a}${rootPrefix}${local}${b}` : all;
  });
}

module.exports = { copyImages, pointAtCopies, imageSources };
