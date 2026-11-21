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

async function downloadImage(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { redirect: 'follow' });
  } catch (err) {
    throw new Error(`image ${url}: ${err.cause ? err.cause.message : err.message}`);
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
async function copyImages(pages, outDir, fetchImpl = fetch) {
  const urls = new Set();
  for (const p of pages) for (const src of imageSources(p.html)) urls.add(src);

  const map = new Map();
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`image ${url}: only full http(s) image URLs are supported`);
    }
    const { name, bytes } = await downloadImage(url, fetchImpl);
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
