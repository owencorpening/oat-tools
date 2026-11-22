'use strict';

// Writes the site from the articles the gate returned, and nothing else.
// Page types (design step 3): Home, Series, Article, Not found.
// Every page is complete HTML with no JavaScript and no outside requests.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { renderBody, firstParagraph } = require('./render');
const { copyImages, pointAtCopies } = require('./images');
const { GateError } = require('./gate');
const { DEFAULT_SERIES, LEGACY_SERIES } = require('./series');

const SITE_NAME = "Owen's Applied Thinking";
const TAGLINE = "It's not activism. It's not theory. It's engineering.";
// Sign-off from oat-standards templates/brand_block.md.
const SIGN_OFF = 'Owen Corpening · Austin, Texas';
// Brand files (oat-standards sop-branding.md, owencorpening/images brand/),
// resized and committed here so the build makes no outside request for them.
const BRAND_SRC = path.join(__dirname, '..', 'brand');
const BRAND_FILES = ['oat-mark.png', 'favicon-32.png', 'apple-touch-icon.png', 'cornerstone.jpg'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const CSS = `:root{--ink:#1f2328;--quiet:#5c636a;--line:#d8dadc;--bg:#ffffff;--granite:#4a4f54;--brass:#b8860b;--band:#f5f4f1;--press:#e6e3dc;--edge:#c9ccd0;--stone:#e9e8e5;--brass-hi:#e9c46a;--glow:rgba(184,134,11,.22)}
@media (prefers-color-scheme:dark){:root{--ink:#e6e7e8;--quiet:#a3a8ad;--line:#3a3f44;--bg:#16181a;--granite:#c9ccd0;--brass:#d4a017;--band:#1d2023;--press:#2c3035;--edge:#34383d;--stone:#212427;--brass-hi:#f3d27a;--glow:rgba(212,160,23,.25)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.6 Georgia,"Times New Roman",serif}
header,main,footer{max-width:42rem;margin:0 auto;padding:0 1rem}
header{border-bottom:3px solid var(--brass);padding-top:1rem;padding-bottom:.75rem}
header{padding-top:1.1rem;padding-bottom:.9rem;background:linear-gradient(180deg,var(--stone),var(--bg) 85%);border-image:linear-gradient(90deg,var(--brass),var(--brass-hi) 45%,var(--brass) 70%,var(--brass)) 1}
header a{display:flex;align-items:center;gap:.75rem;color:var(--granite);text-decoration:none}
header img{display:block;height:40px;width:auto}
.mark{position:relative;display:block;border-radius:3px;overflow:hidden;line-height:0}
.mark::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.55) 48%,transparent 66%);transform:translateX(-120%);pointer-events:none;animation:sheen 1.4s .35s ease-out both}
header a:hover .mark::after{animation:sheen2 1s ease-out}
@keyframes sheen{to{transform:translateX(120%)}}
@keyframes sheen2{from{transform:translateX(-120%)}to{transform:translateX(120%)}}
header span.name{font:400 .95rem/1.2 Georgia,"Times New Roman",serif;letter-spacing:.18em;text-transform:uppercase}
footer{border-top:1px solid var(--line);margin-top:3rem;padding-top:1rem;padding-bottom:2rem;color:var(--quiet);font:.9rem/1.5 system-ui,sans-serif}
h1,h2,h3{font-family:system-ui,sans-serif;color:var(--granite);line-height:1.25}
h1{font-size:2rem;margin:1.5rem 0 .5rem}
a{color:var(--brass)}
img{max-width:100%;height:auto}
@media (max-width:30rem){article img[style*="float"]{float:none!important;display:block;margin:0 auto 1rem!important}}
table{border-collapse:collapse;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:.3rem .5rem}
blockquote{border-left:3px solid var(--brass);margin-left:0;padding-left:1rem;color:var(--quiet)}
.meta{color:var(--quiet);font:.95rem/1.4 system-ui,sans-serif}
.list{list-style:none;padding:0}
.list li{position:relative;border:1px solid var(--line);border-radius:8px;padding:.9rem 1rem;margin:0 0 .85rem;background:var(--bg);box-shadow:0 4px 0 var(--edge);transition:transform .12s,box-shadow .12s,background .12s,border-color .12s}
.list li:nth-child(even){background:var(--band)}
.list li:hover{border-color:var(--brass)}
.list li:hover{transform:translateY(-2px);box-shadow:0 6px 0 var(--edge),0 10px 24px var(--glow)}
.list li:active{transform:translateY(4px);box-shadow:0 0 0 var(--edge);background:var(--press)}
.list a{font:600 1.1rem/1.3 system-ui,sans-serif;text-decoration:none}
.list a::after{content:"";position:absolute;inset:0;border-radius:8px}
.list p{margin:.3rem 0 0;color:var(--quiet);font-size:.95rem}
.pager{display:flex;justify-content:space-between;align-items:stretch;gap:1rem;border-top:1px solid var(--line);margin-top:2rem;padding-top:1rem;font:.95rem/1.4 system-ui,sans-serif}
.pager a{flex:1 1 0;max-width:48%;padding:.55rem .85rem;border:1px solid var(--line);border-radius:6px;background:var(--band);color:var(--granite);text-decoration:none;font-weight:600;box-shadow:0 3px 0 var(--edge);transition:transform .06s,box-shadow .06s}
.pager a:hover{border-color:var(--brass);box-shadow:0 3px 0 var(--edge),0 6px 16px var(--glow)}
.pager a:active{transform:translateY(3px);box-shadow:0 0 0 var(--edge);background:var(--press)}
.pager .next{margin-left:auto;text-align:right}
.pager-top{display:flex;justify-content:space-between;gap:.75rem;margin:.25rem 0 1.25rem;font:600 .85rem/1 system-ui,sans-serif}
.pager-top a{padding:.45rem .75rem;border:1px solid var(--line);border-radius:6px;background:var(--band);color:var(--granite);text-decoration:none;box-shadow:0 3px 0 var(--edge);transition:transform .06s,box-shadow .06s}
.pager-top a:hover{border-color:var(--brass);box-shadow:0 3px 0 var(--edge),0 6px 16px var(--glow)}
.pager-top a:active{transform:translateY(3px);box-shadow:0 0 0 var(--edge);background:var(--press)}
.pager-top .next{margin-left:auto}
.pager-top a:focus-visible{outline:3px solid var(--brass);outline-offset:3px}
.pager small{display:block;margin-bottom:.2rem;color:var(--quiet);font-weight:400;font-size:.8rem;letter-spacing:.04em;text-transform:uppercase}
.list a:focus-visible,.pager a:focus-visible{outline:3px solid var(--brass);outline-offset:3px}
main>*,.list li{animation:rise .5s ease-out both}
main>*:nth-child(2){animation-delay:.08s}
main>*:nth-child(3){animation-delay:.16s}
.list li:nth-child(2){animation-delay:.24s}
.list li:nth-child(3){animation-delay:.32s}
.list li:nth-child(n+4){animation-delay:.4s}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
.list li.has-thumb{display:flex;gap:.9rem;align-items:flex-start}
.list li.has-thumb>div{min-width:0}
.thumb{flex:none;display:block;width:72px;height:72px;border-radius:6px;object-fit:cover;border:1px solid var(--edge);box-shadow:0 1px 0 var(--edge)}
.thumb.none{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--stone),var(--bg));color:var(--brass);font:600 .8rem/1 Georgia,"Times New Roman",serif;letter-spacing:.12em}
.cover{margin:1.25rem 0 0}
.cover img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;box-shadow:0 2px 0 var(--edge),0 8px 20px var(--glow)}
.pager-top a{min-height:44px;display:inline-flex;align-items:center}
@media (max-width:40rem){.list li p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}}
@media (max-width:24rem){.thumb{width:56px;height:56px}.list li.has-thumb{gap:.7rem}}
@media (orientation:landscape) and (max-height:500px){.cover img,.hero img{max-height:55vh}}
.also{font:.95rem/1.4 system-ui,sans-serif}
.hero{margin:1.25rem 0 0;border-radius:4px;overflow:hidden}
.hero img{display:block;width:100%;aspect-ratio:2.15/1;object-fit:cover;object-position:center 45%}
.sig{display:block;color:var(--ink);font-style:italic;font-family:Georgia,"Times New Roman",serif}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;
// Changes whenever the stylesheet does, so browsers and the Pages cache
// fetch the new one instead of reusing a stale copy.
const CSS_VERSION = crypto.createHash('sha256').update(CSS).digest('hex').slice(0, 10);

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function partLabel(part) {
  if (!part) return null;
  if (/^\d+$/.test(part)) return `Part ${Number(part)}`;
  return part.charAt(0).toUpperCase() + part.slice(1);
}

// Numbered parts first in order, then the rest newest first.
function seriesOrder(a, b) {
  const na = /^\d+$/.test(a.part || '') ? Number(a.part) : null;
  const nb = /^\d+$/.test(b.part || '') ? Number(b.part) : null;
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return b.published.localeCompare(a.published);
}

// footerTagline: false on the home page, which shows the tagline under the hero.
function page({ title, description, canonical, rootPrefix, body, footerTagline = true, image = null }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">\n` : ''}${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">\n` : ''}${image ? `<meta property="og:image" content="${escapeHtml(image)}">\n` : ''}<link rel="stylesheet" href="${rootPrefix}style.css?v=${CSS_VERSION}">
<link rel="icon" type="image/png" sizes="32x32" href="${rootPrefix}brand/favicon-32.png">
<link rel="apple-touch-icon" href="${rootPrefix}brand/apple-touch-icon.png">
</head>
<body>
<header><a href="${rootPrefix || './'}"><span class="mark"><img src="${rootPrefix}brand/oat-mark.png" alt="OAT" width="100" height="40"></span><span class="name">${escapeHtml(SITE_NAME)}</span></a></header>
<main>
${body}
</main>
<footer>${footerTagline ? escapeHtml(TAGLINE) : ''}<span class="sig">${escapeHtml(SIGN_OFF)}</span></footer>
</body>
</html>
`;
}

function redirectPage(target, canonicalUrl) {
  const t = escapeHtml(target);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Moved · ${escapeHtml(SITE_NAME)}</title>
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${t}">
${canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">\n` : ''}</head>
<body>
<p>This page has moved to <a href="${t}">${t}</a>.</p>
</body>
</html>
`;
}

function writeFile(outDir, relPath, content) {
  const full = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// options: { series: Map from readSeries, baseUrl: 'https://…/oat-web/', fetchImpl }
// Refuses a non-empty output directory, so stale pages from an earlier
// build can never survive an unpublish.
async function writeSite(articles, outDir, options = {}) {
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    throw new Error(`output directory ${outDir} is not empty`);
  }
  const series = options.series || new Map([[DEFAULT_SERIES, { id: DEFAULT_SERIES, name: 'Vectors', description: '', order: 1000 }]]);
  const baseUrl = options.baseUrl ? options.baseUrl.replace(/\/?$/, '/') : null;
  const basePath = baseUrl ? new URL(baseUrl).pathname : '/';
  const canonical = (rel) => (baseUrl ? baseUrl + rel : null);

  const problems = [];
  for (const a of articles) {
    if (!series.has(a.series)) problems.push(`${a.tag}: series "${a.series}" is not in site/series.json`);
  }
  if (problems.length) throw new GateError(problems);

  // Group and order.
  const bySeries = new Map();
  for (const a of articles) {
    if (!bySeries.has(a.series)) bySeries.set(a.series, []);
    bySeries.get(a.series).push(a);
  }
  for (const list of bySeries.values()) list.sort(seriesOrder);
  const shownSeries = [...bySeries.keys()]
    .map((id) => series.get(id))
    .sort((x, y) => x.order - y.order || x.name.localeCompare(y.name));

  // Render article bodies; links between published articles become site links.
  const bySubstackSlug = new Map();
  for (const a of articles) {
    const m = a.substackUrl && /\/p\/([A-Za-z0-9-]+)/.exec(a.substackUrl);
    if (m) bySubstackSlug.set(m[1].toLowerCase(), a);
  }
  const rendered = new Map();
  for (const a of articles) {
    const { html, problems: p } = renderBody(a, {
      bySubstackSlug,
      linkTo: (t) => `../../${t.series}/${t.slug}/`
    });
    problems.push(...p);
    rendered.set(a, html);
  }
  if (problems.length) throw new GateError(problems);

  fs.mkdirSync(outDir, { recursive: true });
  // Covers (header `cover:`) are copied like any other image.
  const coverPages = articles.filter((a) => a.cover).map((a) => ({ html: `<img src="${escapeHtml(a.cover)}">` }));
  const imageMap = await copyImages([...[...rendered.values()].map((html) => ({ html })), ...coverPages], outDir, options.fetchImpl, options.retryDelaysMs);
  const coverOf = (a) => (a && a.cover ? imageMap.get(a.cover) : null);
  // A small square on a list card: the cover, or a plain OAT tile.
  const thumb = (local, rootPrefix) => (local
    ? `<img class="thumb" src="${rootPrefix}${local}" alt="" width="72" height="72" loading="lazy">`
    : '<span class="thumb none" aria-hidden="true">OAT</span>');

  writeFile(outDir, 'style.css', CSS);
  fs.mkdirSync(path.join(outDir, 'brand'), { recursive: true });
  for (const f of BRAND_FILES) fs.copyFileSync(path.join(BRAND_SRC, f), path.join(outDir, 'brand', f));

  // Home.
  const homeList = shownSeries.map((s) => {
    const n = bySeries.get(s.id).length;
    const first = bySeries.get(s.id).find((a) => a.cover);
    return `<li class="has-thumb">${thumb(coverOf(first), '')}<div><a href="${s.id}/">${escapeHtml(s.name)}</a><p>${escapeHtml(s.description)} · ${n} article${n === 1 ? '' : 's'}</p></div></li>`;
  }).join('\n');
  writeFile(outDir, 'index.html', page({
    title: SITE_NAME,
    description: TAGLINE,
    footerTagline: false,
    canonical: canonical(''),
    rootPrefix: '',
    body: `<h1 class="visually-hidden">${escapeHtml(SITE_NAME)}</h1>\n<figure class="hero"><img src="brand/cornerstone.jpg" alt="OAT carved in a granite cornerstone" width="1200" height="800"></figure>\n<p class="meta">${escapeHtml(TAGLINE)}</p>\n<ul class="list">\n${homeList}\n</ul>`
  }));

  // Series pages.
  for (const s of shownSeries) {
    const items = bySeries.get(s.id).map((a) => {
      const label = partLabel(a.part);
      const desc = a.description || firstParagraph(a.body);
      return `<li class="has-thumb">${thumb(coverOf(a), '../')}<div><a href="${a.slug}/">${escapeHtml(a.title)}</a><p>${label ? `${escapeHtml(label)} · ` : ''}${formatDate(a.published)}${desc ? ` · ${escapeHtml(desc)}` : ''}</p></div></li>`;
    }).join('\n');
    writeFile(outDir, `${s.id}/index.html`, page({
      title: `${s.name} · ${SITE_NAME}`,
      description: s.description,
      canonical: canonical(`${s.id}/`),
      rootPrefix: '../',
      body: `<h1>${escapeHtml(s.name)}</h1>\n<p class="meta">${escapeHtml(s.description)}</p>\n<ul class="list">\n${items}\n</ul>`
    }));
  }

  // Article pages.
  for (const s of shownSeries) {
    const list = bySeries.get(s.id);
    list.forEach((a, i) => {
      const prev = list[i - 1];
      const next = list[i + 1];
      const label = partLabel(a.part);
      const meta = [formatDate(a.published), `<a href="../">${escapeHtml(s.name)}</a>`, label ? escapeHtml(label) : null]
        .filter(Boolean).join(' · ');
      const also = [
        a.substackUrl ? `<a href="${escapeHtml(a.substackUrl)}">Substack</a>` : null,
        a.linkedinUrl ? `<a href="${escapeHtml(a.linkedinUrl)}">LinkedIn</a>` : null
      ].filter(Boolean);
      const pager = (prev || next)
        ? `<nav class="pager">${prev ? `<a class="prev" href="../${prev.slug}/"><small>← Previous</small>${escapeHtml(prev.title)}</a>` : ''}${next ? `<a class="next" href="../${next.slug}/"><small>Next →</small>${escapeHtml(next.title)}</a>` : ''}</nav>`
        : '';
      const html = pointAtCopies(rendered.get(a), imageMap, '../../');
      // Every article with a neighbour gets the compact pair under the date line,
      // so the buttons never seem to vanish while paging through a series.
      const topPager = (prev || next)
        ? `<nav class="pager-top" aria-label="Previous and next">${prev ? `<a class="prev" href="../${prev.slug}/" title="${escapeHtml(prev.title)}">← Previous</a>` : ''}${next ? `<a class="next" href="../${next.slug}/" title="${escapeHtml(next.title)}">Next →</a>` : ''}</nav>\n`
        : '';
      // A cover that the article already shows (same image file) is not
      // repeated above the title; it still appears on the cards.
      const cover = coverOf(a);
      const coverOnTop = cover && !html.includes(`src="../../${cover}"`);
      writeFile(outDir, `${s.id}/${a.slug}/index.html`, page({
        title: `${a.title} · ${SITE_NAME}`,
        description: a.description || firstParagraph(a.body),
        canonical: canonical(`${s.id}/${a.slug}/`),
        image: cover && baseUrl ? baseUrl + cover : null,
        rootPrefix: '../../',
        body: `<article>\n${coverOnTop ? `<figure class="cover"><img src="../../${cover}" alt=""></figure>\n` : ''}<h1>${escapeHtml(a.title)}</h1>\n<p class="meta">${meta}</p>\n${topPager}${html}\n</article>\n${also.length ? `<p class="also">Also on ${also.join(' and ')}.</p>\n` : ''}${pager}`
      }));
    });
  }

  // Redirects from old series ids (e.g. /standalone/ -> /vectors/), so links
  // shared before a rename keep working. Plain HTML, no JavaScript.
  for (const [oldId, newId] of LEGACY_SERIES) {
    if (!bySeries.has(newId) || series.has(oldId)) continue;
    writeFile(outDir, `${oldId}/index.html`, redirectPage('../' + newId + '/', canonical(`${newId}/`)));
    for (const a of bySeries.get(newId)) {
      writeFile(outDir, `${oldId}/${a.slug}/index.html`,
        redirectPage(`../../${newId}/${a.slug}/`, canonical(`${newId}/${a.slug}/`)));
    }
  }

  // Redirects for articles moved to another series (e.g. /family/x/ ->
  // /science/x/), including the old id of a renamed series. A former series
  // left with no articles redirects its index to the home page.
  const shown = new Set(shownSeries.map((s) => s.id));
  for (const a of articles) {
    const from = new Set(a.formerSeries || []);
    for (const [oldId, newId] of LEGACY_SERIES) if (from.has(newId)) from.add(oldId);
    for (const oldId of from) {
      if (shown.has(oldId)) {
        if (bySeries.get(oldId).some((b) => b.slug === a.slug)) continue;
      } else if (!fs.existsSync(path.join(outDir, oldId, 'index.html'))) {
        writeFile(outDir, `${oldId}/index.html`, redirectPage('../', canonical('')));
      }
      writeFile(outDir, `${oldId}/${a.slug}/index.html`,
        redirectPage(`../../${a.series}/${a.slug}/`, canonical(`${a.series}/${a.slug}/`)));
    }
  }

  // Not found: served at any depth, so it uses absolute paths and lists nothing.
  writeFile(outDir, '404.html', page({
    title: `Not found · ${SITE_NAME}`,
    canonical: null,
    rootPrefix: basePath,
    body: `<h1>Page not found</h1>\n<p><a href="${escapeHtml(basePath)}">Go to the home page</a></p>`
  }));
}

module.exports = { writeSite, escapeHtml };
