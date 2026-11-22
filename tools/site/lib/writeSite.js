'use strict';

// Writes the site from the articles the gate returned, and nothing else.
// Page types (design step 3): Home, Series, Article, Not found.
// Every page is complete HTML with no JavaScript and no outside requests.

const fs = require('fs');
const path = require('path');
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

const CSS = `:root{--ink:#1f2328;--quiet:#5c636a;--line:#d8dadc;--bg:#ffffff;--granite:#4a4f54;--brass:#b8860b}
@media (prefers-color-scheme:dark){:root{--ink:#e6e7e8;--quiet:#a3a8ad;--line:#3a3f44;--bg:#16181a;--granite:#c9ccd0;--brass:#d4a017}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.6 Georgia,"Times New Roman",serif}
header,main,footer{max-width:42rem;margin:0 auto;padding:0 1rem}
header{border-bottom:3px solid var(--brass);padding-top:1rem;padding-bottom:.75rem}
header{padding-top:1.1rem;padding-bottom:.9rem}
header a{display:flex;align-items:center;gap:.75rem;color:var(--granite);text-decoration:none}
header img{display:block;height:40px;width:auto;border-radius:3px}
header span{font:400 .95rem/1.2 Georgia,"Times New Roman",serif;letter-spacing:.18em;text-transform:uppercase}
footer{border-top:1px solid var(--line);margin-top:3rem;padding-top:1rem;padding-bottom:2rem;color:var(--quiet);font:.9rem/1.5 system-ui,sans-serif}
h1,h2,h3{font-family:system-ui,sans-serif;color:var(--granite);line-height:1.25}
h1{font-size:2rem;margin:1.5rem 0 .5rem}
a{color:var(--brass)}
img{max-width:100%;height:auto}
table{border-collapse:collapse;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:.3rem .5rem}
blockquote{border-left:3px solid var(--brass);margin-left:0;padding-left:1rem;color:var(--quiet)}
.meta{color:var(--quiet);font:.95rem/1.4 system-ui,sans-serif}
.list{list-style:none;padding:0}
.list li{border-bottom:1px solid var(--line);padding:.9rem 0}
.list a{font:600 1.1rem/1.3 system-ui,sans-serif}
.list p{margin:.3rem 0 0;color:var(--quiet);font-size:.95rem}
.pager{display:flex;justify-content:space-between;gap:1rem;border-top:1px solid var(--line);margin-top:2rem;padding-top:1rem;font:.95rem/1.4 system-ui,sans-serif}
.also{font:.95rem/1.4 system-ui,sans-serif}
.hero{margin:1.25rem 0 0;border-radius:4px;overflow:hidden}
.hero img{display:block;width:100%;aspect-ratio:2.15/1;object-fit:cover;object-position:center 45%}
.sig{display:block;color:var(--ink);font-style:italic;font-family:Georgia,"Times New Roman",serif}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

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
function page({ title, description, canonical, rootPrefix, body, footerTagline = true }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">\n` : ''}${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">\n` : ''}<link rel="stylesheet" href="${rootPrefix}style.css">
<link rel="icon" type="image/png" sizes="32x32" href="${rootPrefix}brand/favicon-32.png">
<link rel="apple-touch-icon" href="${rootPrefix}brand/apple-touch-icon.png">
</head>
<body>
<header><a href="${rootPrefix || './'}"><img src="${rootPrefix}brand/oat-mark.png" alt="OAT" width="100" height="40"><span>${escapeHtml(SITE_NAME)}</span></a></header>
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
  const imageMap = await copyImages([...rendered.values()].map((html) => ({ html })), outDir, options.fetchImpl, options.retryDelaysMs);

  writeFile(outDir, 'style.css', CSS);
  fs.mkdirSync(path.join(outDir, 'brand'), { recursive: true });
  for (const f of BRAND_FILES) fs.copyFileSync(path.join(BRAND_SRC, f), path.join(outDir, 'brand', f));

  // Home.
  const homeList = shownSeries.map((s) => {
    const n = bySeries.get(s.id).length;
    return `<li><a href="${s.id}/">${escapeHtml(s.name)}</a><p>${escapeHtml(s.description)} · ${n} article${n === 1 ? '' : 's'}</p></li>`;
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
      return `<li><a href="${a.slug}/">${escapeHtml(a.title)}</a><p>${label ? `${escapeHtml(label)} · ` : ''}${formatDate(a.published)}${desc ? ` · ${escapeHtml(desc)}` : ''}</p></li>`;
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
        ? `<nav class="pager"><span>${prev ? `← <a href="../${prev.slug}/">${escapeHtml(prev.title)}</a>` : ''}</span><span>${next ? `<a href="../${next.slug}/">${escapeHtml(next.title)}</a> →` : ''}</span></nav>`
        : '';
      const html = pointAtCopies(rendered.get(a), imageMap, '../../');
      writeFile(outDir, `${s.id}/${a.slug}/index.html`, page({
        title: `${a.title} · ${SITE_NAME}`,
        description: a.description || firstParagraph(a.body),
        canonical: canonical(`${s.id}/${a.slug}/`),
        rootPrefix: '../../',
        body: `<article>\n<h1>${escapeHtml(a.title)}</h1>\n<p class="meta">${meta}</p>\n${html}\n</article>\n${also.length ? `<p class="also">Also on ${also.join(' and ')}.</p>\n` : ''}${pager}`
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
