'use strict';

// Writes the site from the articles the gate returned, and nothing else.
// Page types (design step 3): Home, Series, Article, Not found.
// Site sections (2026-11-22): OAT home at /, Writing at /writing/ (series and
// articles below it), Free tools at /tools/, Products at /products/.
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
const BRAND_FILES = ['oat-mark.png', 'favicon-32.png', 'apple-touch-icon.png', 'cornerstone.jpg', 'search-grid-icon.png', 'cheatsheets-icon.png'];
// Writing lives under this folder. Old /<series>/... addresses redirect here.
const WRITING = 'writing';
// Top-level folders a series id must not take, since old /<series>/ addresses
// become redirect pages at the site root.
const RESERVED_IDS = new Set([WRITING, 'tools', 'products', 'about', 'brand', 'assets']);
// Header menu: [section id, label, path from the site root].
const NAV = [['writing', 'Writing', 'writing/'], ['tools', 'Free tools', 'tools/'], ['products', 'Products', 'products/'], ['about', 'About', 'about/']];
// About page wording: oat-standards templates/brand_block.md (intro, mission,
// disclaimer) and sops/actions/sop-pre-publish-review.md (bio footer).
// "35+ years" replaces brand_block's "five decades" (Owen, 2026-11-22).
// "Things I've built" lines are the GitHub repo descriptions (Search Grid:
// the one-line description proposed for yt-grid-extension, 2026-11-22).
// Never add new wording here; change oat-standards first.
const SUBSTACK_URL = 'https://owencorpening.substack.com/';
const LINKEDIN_URL = 'https://www.linkedin.com/in/owencorpening/';
// Free tools: listed on /tools/, on About and counted on the home page.
// Wording as on the About page before 2026-11-22 (see above).
const FREE_TOOLS = [
  { name: 'Search Grid &amp; Recency Filter for YouTube™', short: 'Search Grid', href: 'tools/search-grid/', local: true, icon: 'brand/search-grid-icon.png',
    note: 'Free Chrome extension · Shows YouTube search results as a grid and hides videos older than a number of days you choose.' },
  { name: 'riffkit', short: 'riffkit', href: 'https://github.com/owencorpening/riffkit',
    note: 'Free, install from GitHub · Turn any song into a practice project: stems you can mute, lyrics on your TV, your phone as the remote. Also splits live concerts into songs.' },
  { name: 'Image Attribution Logger', short: 'Image Attribution Logger', href: 'https://github.com/owencorpening/image-capture',
    note: 'Free, install from GitHub · The Image Attribution Logger is a seamless, zero-friction tool that automates image compliance for content creation.' },
  // Wording: oat-standards product-inventory.md (added 2026-11-22 at Owen's request).
  { name: 'Cheatsheets', short: 'Cheatsheets', href: 'tools/cheatsheets/', local: true, icon: 'brand/cheatsheets-icon.png',
    note: 'Free VS Code extension, install from GitHub · Shows your own Markdown and HTML cheatsheets in the secondary sidebar.' }
];
function toolsList(rootPrefix, thumbs) {
  const items = FREE_TOOLS.map((t) => {
    const href = t.local ? rootPrefix + t.href : t.href;
    const link = `<a href="${href}">${t.name}</a><p>${t.note}</p>`;
    if (!thumbs) return `<li>${link}</li>`;
    const img = t.icon
      ? `<img class="thumb" src="${rootPrefix}${t.icon}" alt="" width="72" height="72" loading="lazy">`
      : '<span class="thumb none" aria-hidden="true">OAT</span>';
    return `<li class="has-thumb">${img}<div>${link}</div></li>`;
  });
  return `<ul class="list">\n${items.join('\n')}\n</ul>`;
}
// "A, B and C"
function andList(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
const ABOUT_BODY = `<div class="about">
<h1>About</h1>
<p class="meta">It's not activism. It's not theory. It's engineering.</p>
<p class="lede">Exploring the hidden logic and overlooked systems of everyday life — from the perspective of a civil engineer (former Texas PE) with 35+ years of field experience across civil infrastructure and software.</p>
<p class="creed">No charity. No mandates. No green ideology.</p>
<h2>Mission</h2>
<p>Most policy discussions about water, energy, and infrastructure begin with the assumption that scarcity is a natural condition to be managed. This publication starts somewhere else: with the premise that most large-scale resource problems are system design failures, and that system design failures can be solved.</p>
<p>The analyses here are preliminary and intended to invite scrutiny. The calculations are stated. The assumptions are open. Engineers, hydrologists, and infrastructure planners are encouraged to challenge the estimates and improve them.</p>
<p><strong>Engineering, not evangelism.</strong></p>
<h2>The author</h2>
<p>Owen Corpening is a 5th-generation Texan and a civil engineer (BSCE, UT Austin; former Texas PE). Political and cultural opinions are mine alone.</p>
<h2>Disclaimer</h2>
<p>I held a Texas PE license and chose not to renew it after I left engineering practice, so this isn't professional engineering services. These are conceptual analyses and preliminary estimates intended for discussion — not stamped drawings you can build from.</p>
<p>If you are actually building something, hire a licensed engineer in your jurisdiction.</p>
<h2>Things I've built</h2>
${toolsList('../', false)}
<h2>Elsewhere</h2>
<ul class="elsewhere"><li><a href="${SUBSTACK_URL}">Substack</a></li><li><a href="${LINKEDIN_URL}">LinkedIn</a></li></ul>
</div>`;
// Product pages for the Search Grid Chrome extension
// (owencorpening/yt-grid-extension). The Chrome Web Store links to these as
// the extension's support page and privacy policy, so their URLs must not
// change. Wording matches that repo's store/listing.md.
const SEARCH_GRID_NAME = 'Search Grid &amp; Recency Filter for YouTube™';
const SEARCH_GRID_REPO = 'https://github.com/owencorpening/yt-grid-extension';
const SEARCH_GRID_STORE = 'https://chromewebstore.google.com/detail/search-grid-recency-filte/ljghjhddjnnnjmaakpimcbidjckddgdf';
const SEARCH_GRID_BODY = `<div class="about">
<h1>${SEARCH_GRID_NAME}</h1>
<p class="meta">Free Chrome extension</p>
<p class="lede">Search results on YouTube come as one long list. This extension lays them out as a grid instead, and can hide videos older than a number of days you choose.</p>
<p><a class="cta" href="${SEARCH_GRID_STORE}">Add to Chrome</a></p>
<h2>What it does</h2>
<ul>
<li><strong>Grid view for search results.</strong> Pick a card width; the number of columns follows your window size.</li>
<li><strong>Recency filter.</strong> Hide videos older than a number of days you choose, on search results and on the home page. Off until you turn it on.</li>
</ul>
<p>Click the toolbar icon, set the card width and the number of days, and press Save. Changes apply right away.</p>
<h2>Install</h2>
<p>Get it free from the <a href="${SEARCH_GRID_STORE}">Chrome Web Store</a>. Developers can also <a href="${SEARCH_GRID_REPO}">build from source on GitHub</a> by following the README there.</p>
<h2>Limits</h2>
<p>The recency filter reads YouTube's English date text, so it works when YouTube is set to English. Videos with no date, such as live streams and Shorts shelves, are always shown.</p>
<h2>Support</h2>
<p>Found a bug or have a question? <a href="${SEARCH_GRID_REPO}/issues">Open an issue on GitHub</a>. It's a free side project, so replies may take a few days.</p>
<p><a href="privacy/">Privacy policy</a> · <a href="${SEARCH_GRID_REPO}">Source code (MIT)</a></p>
<p class="meta">YouTube is a trademark of Google LLC. This extension is not made, endorsed, or sponsored by Google or YouTube.</p>
</div>`;
const SEARCH_GRID_PRIVACY_BODY = `<div class="about">
<h1>Privacy policy</h1>
<p class="meta">${SEARCH_GRID_NAME} · Effective November 22, 2026</p>
<p class="lede">This extension collects no personal information and sends nothing anywhere.</p>
<h2>What it stores</h2>
<p>Two settings you choose in its popup: the card width and the maximum video age in days. They are saved with Chrome's own settings storage (<code>chrome.storage.sync</code>). If you have Chrome sync turned on, Chrome copies them to your other computers through your Google account, the same way it syncs your other Chrome settings. The extension's author never receives them.</p>
<h2>What it reads</h2>
<p>It runs only on youtube.com. To apply the recency filter it reads the date text shown on each video card, such as "3 days ago", in your browser. That text is used only to decide whether to hide the card. It is not saved or sent anywhere.</p>
<h2>What it doesn't do</h2>
<ul>
<li>No analytics, tracking, ads, or cookies.</li>
<li>No network requests of its own and no remote code.</li>
<li>No reading of your browsing history, account, or anything outside youtube.com.</li>
<li>Nothing is sold or shared with anyone.</li>
</ul>
<h2>Permissions</h2>
<p><strong>Storage</strong>, to save the two settings. <strong>Access to youtube.com</strong>, to change how YouTube lists videos.</p>
<h2>Changes</h2>
<p>If this ever changes, this page will be updated before the extension does, with a new effective date.</p>
<h2>Contact</h2>
<p><a href="${SEARCH_GRID_REPO}/issues">Open an issue on GitHub</a>.</p>
<p><a href="../">Back to the extension page</a></p>
</div>`;
// Product page for the Cheatsheets VS Code extension
// (owencorpening/cheatsheets-vscode). Its package.json names this page as the
// extension's homepage, so the URL must not change. Wording matches that
// repo's README.
const CHEATSHEETS_REPO = 'https://github.com/owencorpening/cheatsheets-vscode';
const CHEATSHEETS_BODY = `<div class="about">
<h1>Cheatsheets</h1>
<p class="meta">Free VS Code extension</p>
<p class="lede">Keep your own reference notes open while you code. Cheatsheets shows the Markdown and HTML files from a folder you choose in VS Code's secondary sidebar: the list on the left, the sheet on the right. One shortcut shows it and hides it.</p>
<h2>What it does</h2>
<ul>
<li><strong>Markdown and HTML.</strong> Write quick sheets in Markdown, with tables, code blocks, and task lists, or build fully styled reference pages in HTML.</li>
<li><strong>Your own folder.</strong> Every <code>.md</code> and <code>.html</code> file in the folder appears in the list, sorted by name.</li>
<li><strong>Stays current.</strong> Add, rename, or edit a file and the panel updates on its own.</li>
<li><strong>Checklists that remember.</strong> Tick a box and it stays ticked the next time you open the sheet.</li>
</ul>
<h2>Install</h2>
<p>The VS Code Marketplace listing is coming soon. Until then you can install it from <a href="${CHEATSHEETS_REPO}">the source on GitHub</a> by following the README there.</p>
<p>Then open Settings, search for <strong>cheatsheets</strong>, and set <strong>Cheatsheets: Folder</strong> to your cheatsheets folder. Press <kbd>Ctrl+Alt+C</kbd> (Mac: <kbd>Ctrl+Cmd+C</kbd>) to open the panel.</p>
<h2>Privacy</h2>
<p>Cheatsheets reads files only from the folder you choose. It collects nothing, sends nothing, and has no analytics or network requests of its own. Which boxes you've ticked is kept by VS Code on your own computer.</p>
<h2>Support</h2>
<p>Found a bug or have a question? <a href="${CHEATSHEETS_REPO}/issues">Open an issue on GitHub</a>. It's a free side project, so replies may take a few days.</p>
<p><a href="${CHEATSHEETS_REPO}">Source code (MIT)</a></p>
</div>`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const CSS = `:root{--ink:#1f2328;--quiet:#5c636a;--line:#d8dadc;--bg:#ffffff;--granite:#4a4f54;--brass:#b8860b;--band:#f5f4f1;--press:#e6e3dc;--edge:#c9ccd0;--stone:#e9e8e5;--brass-hi:#e9c46a;--glow:rgba(184,134,11,.22)}
@media (prefers-color-scheme:dark){:root{--ink:#e6e7e8;--quiet:#a3a8ad;--line:#3a3f44;--bg:#16181a;--granite:#c9ccd0;--brass:#d4a017;--band:#1d2023;--press:#2c3035;--edge:#34383d;--stone:#212427;--brass-hi:#f3d27a;--glow:rgba(212,160,23,.25)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.6 Georgia,"Times New Roman",serif}
header,main,footer{max-width:42rem;margin:0 auto;padding:0 1rem}
header{border-bottom:3px solid var(--brass);padding-top:1rem;padding-bottom:.75rem}
header{padding-top:1.1rem;padding-bottom:.9rem;background:linear-gradient(180deg,var(--stone),var(--bg) 85%);border-image:linear-gradient(90deg,var(--brass),var(--brass-hi) 45%,var(--brass) 70%,var(--brass)) 1}
header{display:flex;align-items:center;justify-content:space-between;gap:.75rem}
header a.home{display:flex;align-items:center;gap:.75rem;min-width:0;color:var(--granite);text-decoration:none}
header nav a{display:inline-flex;align-items:center;min-height:44px;color:var(--granite);text-decoration:none;font:600 .8rem/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;border-bottom:2px solid transparent}
header nav a:hover,header nav a[aria-current]{color:var(--brass);border-bottom-color:var(--brass)}
header nav a:focus-visible,footer a:focus-visible{outline:3px solid var(--brass);outline-offset:3px}
header img{display:block;height:40px;width:auto}
.mark{position:relative;display:block;border-radius:3px;overflow:hidden;line-height:0}
.mark::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.55) 48%,transparent 66%);transform:translateX(-120%);pointer-events:none;animation:sheen 1.4s .35s ease-out both}
header a.home:hover .mark::after{animation:sheen2 1s ease-out}
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
.about h2{font-size:1.15rem;margin:2rem 0 .5rem;padding-top:1rem;border-top:1px solid var(--line)}
.about .list li p{display:block;overflow:visible}
.about .lede{font-size:1.1rem}
.about .creed{font-style:italic;color:var(--granite)}
.about .elsewhere{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.75rem;font:600 .95rem/1 system-ui,sans-serif}
.about .elsewhere a{display:inline-flex;align-items:center;min-height:44px;padding:0 1rem;border:1px solid var(--line);border-radius:6px;background:var(--band);color:var(--granite);text-decoration:none;box-shadow:0 3px 0 var(--edge)}
.about .cta{display:inline-flex;align-items:center;min-height:44px;padding:0 1.25rem;border:2px solid var(--brass);border-radius:6px;background:var(--band);color:var(--granite);text-decoration:none;font:600 1rem/1 system-ui,sans-serif;box-shadow:0 3px 0 var(--edge)}
.about .cta:hover{background:var(--press)}
.about .cta:focus-visible{outline:3px solid var(--brass);outline-offset:3px}
.about .elsewhere a:hover{border-color:var(--brass);box-shadow:0 3px 0 var(--edge),0 6px 16px var(--glow)}
.about .elsewhere a:active{transform:translateY(3px);box-shadow:0 0 0 var(--edge);background:var(--press)}
footer .links{display:block;margin-top:.5rem}
footer .links a{color:var(--quiet)}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.count{position:absolute;width:1px;height:1px;opacity:0}
header nav{display:flex;gap:1.1rem;white-space:nowrap}
@media (max-width:40rem){header{flex-wrap:wrap;row-gap:.35rem}header nav{width:100%;justify-content:space-between;gap:.25rem;border-top:1px solid var(--line);padding-top:.15rem}header nav a{font-size:.74rem;letter-spacing:.1em}}
@media (max-width:22rem){header nav a{font-size:.68rem;letter-spacing:.05em}}
.crumbs{max-width:42rem;margin:0 auto;padding:.2rem 1rem;background:var(--band);border-bottom:1px solid var(--line);font:600 .74rem/1.3 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--quiet)}
.crumbs a{display:inline-block;padding:.45rem 0;color:var(--granite);text-decoration:none}
.crumbs a:hover{color:var(--brass)}
.crumbs a:focus-visible{outline:3px solid var(--brass);outline-offset:2px}
.crumbs .sep{color:var(--brass);margin:0 .45rem}
.doors .list a{font-size:1.25rem}
.doors .thumb{width:88px;height:88px}
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
// Adds the page title (without the site name) so the GoatCounter dashboard
// lists pages by name, not just path.
function pixelWithTitle(pixel, title) {
  const short = title.replace(new RegExp(`\\s*·\\s*${SITE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '') || SITE_NAME;
  return `${pixel}&t=${encodeURIComponent(short)}`;
}

// pixel: GoatCounter count URL for this page, or null for no counter.
// current: the menu section this page belongs to; currentIsPage when the page
// is that section's own index. crumbs: [[label, href or null], ...] for the
// breadcrumb band under the header, starting at OAT.
function page({ title, description, canonical, rootPrefix, body, footerTagline = true, image = null, current = null, currentIsPage = false, crumbs = null, pixel = null }) {
  const nav = NAV.map(([id, label, href]) => `<a href="${rootPrefix}${href}"${current === id ? ` aria-current="${currentIsPage ? 'page' : 'true'}"` : ''}>${escapeHtml(label)}</a>`).join('');
  const band = crumbs
    ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map(([label, href]) => (href ? `<a href="${href}">${escapeHtml(label)}</a>` : `<span aria-current="page">${escapeHtml(label)}</span>`)).join('<span class="sep" aria-hidden="true">›</span>')}</nav>\n`
    : '';
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
<header><a class="home" href="${rootPrefix || './'}"><span class="mark"><img src="${rootPrefix}brand/oat-mark.png" alt="OAT" width="100" height="40"></span><span class="name">${escapeHtml(SITE_NAME)}</span></a><nav aria-label="Site">${nav}</nav></header>
${band}<main>
${body}
</main>
<footer>${footerTagline ? escapeHtml(TAGLINE) : ''}<span class="sig">${escapeHtml(SIGN_OFF)}</span><span class="links"><a href="${rootPrefix}about/">About</a> · <a href="${SUBSTACK_URL}">Substack</a> · <a href="${LINKEDIN_URL}">LinkedIn</a></span></footer>
${pixel ? `<img class="count" src="${escapeHtml(pixelWithTitle(pixel, title))}" alt="" width="1" height="1">\n` : ''}</body>
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

// options: { series: Map from readSeries, baseUrl: 'https://owensappliedthinking.com/', goatcounter: 'code', fetchImpl }
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
  // Visitor counter: a GoatCounter image, no JavaScript and no cookies.
  const code = options.goatcounter || null;
  if (code && !/^[a-z0-9-]+$/.test(code)) throw new Error(`bad GoatCounter code: ${code}`);
  const pixel = (rel) => (code ? `https://${code}.goatcounter.com/count?p=${encodeURI('/' + rel)}` : null);

  const problems = [];
  for (const a of articles) {
    if (!series.has(a.series)) problems.push(`${a.tag}: series "${a.series}" is not in site/series.json`);
    else if (RESERVED_IDS.has(a.series)) problems.push(`${a.tag}: series id "${a.series}" is taken by a site section; pick another`);
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

  // Home: the OAT front door, one card for each part of the site.
  const total = articles.length;
  const firstCover = shownSeries.map((x) => coverOf(bySeries.get(x.id).find((a) => a.cover))).find(Boolean);
  const doors = [
    `<li class="has-thumb">${thumb(firstCover, '')}<div><a href="${WRITING}/">Writing</a><p>${escapeHtml(andList(shownSeries.map((x) => x.name)))} · ${total} article${total === 1 ? '' : 's'}</p></div></li>`,
    `<li class="has-thumb"><img class="thumb" src="brand/search-grid-icon.png" alt="" width="72" height="72" loading="lazy"><div><a href="tools/">Free tools</a><p>${andList(FREE_TOOLS.map((t) => t.short))} · ${FREE_TOOLS.length} tools</p></div></li>`,
    '<li class="has-thumb"><span class="thumb none" aria-hidden="true">OAT</span><div><a href="products/">Products</a><p>Coming soon</p></div></li>'
  ].join('\n');
  writeFile(outDir, 'index.html', page({
    title: SITE_NAME,
    description: TAGLINE,
    footerTagline: false,
    canonical: canonical(''),
    pixel: pixel(''),
    rootPrefix: '',
    body: `<h1 class="visually-hidden">${escapeHtml(SITE_NAME)}</h1>\n<figure class="hero"><img src="brand/cornerstone.jpg" alt="OAT carved in a granite cornerstone" width="1200" height="800"></figure>\n<p class="meta">${escapeHtml(TAGLINE)}</p>\n<div class="doors"><ul class="list">\n${doors}\n</ul></div>`
  }));

  // Writing index: one card per series.
  const seriesCards = shownSeries.map((x) => {
    const n = bySeries.get(x.id).length;
    const first = bySeries.get(x.id).find((a) => a.cover);
    return `<li class="has-thumb">${thumb(coverOf(first), '../')}<div><a href="${x.id}/">${escapeHtml(x.name)}</a><p>${escapeHtml(x.description)} · ${n} article${n === 1 ? '' : 's'}</p></div></li>`;
  }).join('\n');
  writeFile(outDir, `${WRITING}/index.html`, page({
    title: `Writing · ${SITE_NAME}`,
    description: TAGLINE,
    canonical: canonical(`${WRITING}/`),
    pixel: pixel(`${WRITING}/`),
    rootPrefix: '../',
    current: 'writing',
    currentIsPage: true,
    crumbs: [['OAT', '../'], ['Writing', null]],
    body: `<h1>Writing</h1>\n<ul class="list">\n${seriesCards}\n</ul>`
  }));

  // Series pages.
  for (const s of shownSeries) {
    const items = bySeries.get(s.id).map((a) => {
      const label = partLabel(a.part);
      const desc = a.description || firstParagraph(a.body);
      return `<li class="has-thumb">${thumb(coverOf(a), '../../')}<div><a href="${a.slug}/">${escapeHtml(a.title)}</a><p>${label ? `${escapeHtml(label)} · ` : ''}${formatDate(a.published)}${desc ? ` · ${escapeHtml(desc)}` : ''}</p></div></li>`;
    }).join('\n');
    writeFile(outDir, `${WRITING}/${s.id}/index.html`, page({
      title: `${s.name} · ${SITE_NAME}`,
      description: s.description,
      canonical: canonical(`${WRITING}/${s.id}/`),
      pixel: pixel(`${WRITING}/${s.id}/`),
      rootPrefix: '../../',
      current: 'writing',
      crumbs: [['OAT', '../../'], ['Writing', '../'], [s.name, null]],
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
      const html = pointAtCopies(rendered.get(a), imageMap, '../../../');
      // Every article with a neighbour gets the compact pair under the date line,
      // so the buttons never seem to vanish while paging through a series.
      const topPager = (prev || next)
        ? `<nav class="pager-top" aria-label="Previous and next">${prev ? `<a class="prev" href="../${prev.slug}/" title="${escapeHtml(prev.title)}">← Previous</a>` : ''}${next ? `<a class="next" href="../${next.slug}/" title="${escapeHtml(next.title)}">Next →</a>` : ''}</nav>\n`
        : '';
      // A cover that the article already shows (same image file) is not
      // repeated above the title; it still appears on the cards.
      const cover = coverOf(a);
      const coverOnTop = cover && !html.includes(`src="../../../${cover}"`);
      writeFile(outDir, `${WRITING}/${s.id}/${a.slug}/index.html`, page({
        title: `${a.title} · ${SITE_NAME}`,
        description: a.description || firstParagraph(a.body),
        canonical: canonical(`${WRITING}/${s.id}/${a.slug}/`),
        pixel: pixel(`${WRITING}/${s.id}/${a.slug}/`),
        image: cover && baseUrl ? baseUrl + cover : null,
        rootPrefix: '../../../',
        current: 'writing',
        crumbs: [['OAT', '../../../'], ['Writing', '../../'], [s.name, '../']],
        body: `<article>\n${coverOnTop ? `<figure class="cover"><img src="../../../${cover}" alt=""></figure>\n` : ''}<h1>${escapeHtml(a.title)}</h1>\n<p class="meta">${meta}</p>\n${topPager}${html}\n</article>\n${also.length ? `<p class="also">Also on ${also.join(' and ')}.</p>\n` : ''}${pager}`
      }));
    });
  }

  // Old addresses: writing sat at the site root (/<series>/<slug>/) until
  // 2026-11-22, and some series had older ids (LEGACY_SERIES, an article's
  // formerSeries). Each old address gets a plain HTML redirect page, so links
  // shared before a move keep working. No JavaScript.
  const toWriting = (rel) => [`${WRITING}/${rel}`, canonical(`${WRITING}/${rel}`)];
  const redirect = (from, rel, depth) => {
    const [target, canon] = toWriting(rel);
    writeFile(outDir, `${from}index.html`, redirectPage('../'.repeat(depth) + target, canon));
  };
  for (const s of shownSeries) {
    redirect(`${s.id}/`, `${s.id}/`, 1);
    for (const a of bySeries.get(s.id)) redirect(`${s.id}/${a.slug}/`, `${s.id}/${a.slug}/`, 2);
  }
  for (const [oldId, newId] of LEGACY_SERIES) {
    if (!bySeries.has(newId) || series.has(oldId)) continue;
    redirect(`${oldId}/`, `${newId}/`, 1);
    for (const a of bySeries.get(newId)) redirect(`${oldId}/${a.slug}/`, `${newId}/${a.slug}/`, 2);
  }
  // Articles moved to another series (e.g. /family/x/ -> /writing/science/x/).
  // A former series left with no articles redirects to the Writing index.
  const shown = new Set(shownSeries.map((s) => s.id));
  for (const a of articles) {
    const from = new Set(a.formerSeries || []);
    for (const [oldId, newId] of LEGACY_SERIES) if (from.has(newId)) from.add(oldId);
    for (const oldId of from) {
      if (shown.has(oldId) && bySeries.get(oldId).some((b) => b.slug === a.slug)) continue;
      if (!fs.existsSync(path.join(outDir, oldId, 'index.html'))) redirect(`${oldId}/`, '', 1);
      redirect(`${oldId}/${a.slug}/`, `${a.series}/${a.slug}/`, 2);
    }
  }

  // About: fixed wording from oat-standards, no article content.
  writeFile(outDir, 'about/index.html', page({
    title: `About · ${SITE_NAME}`,
    description: TAGLINE,
    canonical: canonical('about/'),
    pixel: pixel('about/'),
    rootPrefix: '../',
    current: 'about',
    currentIsPage: true,
    body: ABOUT_BODY
  }));

  // Free tools index.
  writeFile(outDir, 'tools/index.html', page({
    title: `Free tools · ${SITE_NAME}`,
    description: 'Free software by Owen Corpening.',
    canonical: canonical('tools/'),
    pixel: pixel('tools/'),
    rootPrefix: '../',
    current: 'tools',
    currentIsPage: true,
    crumbs: [['OAT', '../'], ['Free tools', null]],
    body: `<h1>Free tools</h1>\n${toolsList('../', true)}`
  }));

  // Products: nothing for sale yet.
  writeFile(outDir, 'products/index.html', page({
    title: `Products · ${SITE_NAME}`,
    description: 'Products from Owen\'s Applied Thinking: coming soon.',
    canonical: canonical('products/'),
    pixel: pixel('products/'),
    rootPrefix: '../',
    current: 'products',
    currentIsPage: true,
    crumbs: [['OAT', '../'], ['Products', null]],
    body: '<h1>Products</h1>\n<p class="meta">Coming soon.</p>'
  }));

  // Search Grid extension: support page and privacy policy (fixed URLs).
  writeFile(outDir, 'tools/search-grid/index.html', page({
    title: `Search Grid & Recency Filter for YouTube · ${SITE_NAME}`,
    description: 'Free Chrome extension: YouTube search results as a grid, plus a filter that hides older videos.',
    canonical: canonical('tools/search-grid/'),
    pixel: pixel('tools/search-grid/'),
    rootPrefix: '../../',
    current: 'tools',
    crumbs: [['OAT', '../../'], ['Free tools', '../'], ['Search Grid', null]],
    body: SEARCH_GRID_BODY
  }));
  writeFile(outDir, 'tools/search-grid/privacy/index.html', page({
    title: `Privacy policy · Search Grid & Recency Filter for YouTube · ${SITE_NAME}`,
    description: 'Privacy policy for the Search Grid & Recency Filter Chrome extension.',
    canonical: canonical('tools/search-grid/privacy/'),
    pixel: pixel('tools/search-grid/privacy/'),
    rootPrefix: '../../../',
    current: 'tools',
    crumbs: [['OAT', '../../../'], ['Free tools', '../../'], ['Search Grid', '../'], ['Privacy', null]],
    body: SEARCH_GRID_PRIVACY_BODY
  }));

  // Cheatsheets extension page (fixed URL: the extension's homepage).
  writeFile(outDir, 'tools/cheatsheets/index.html', page({
    title: `Cheatsheets for VS Code · ${SITE_NAME}`,
    description: 'Free VS Code extension: your own Markdown and HTML cheatsheets in the secondary sidebar.',
    canonical: canonical('tools/cheatsheets/'),
    pixel: pixel('tools/cheatsheets/'),
    rootPrefix: '../../',
    current: 'tools',
    crumbs: [['OAT', '../../'], ['Free tools', '../'], ['Cheatsheets', null]],
    body: CHEATSHEETS_BODY
  }));

  // Not found: served at any depth, so it uses absolute paths and lists nothing.
  writeFile(outDir, '404.html', page({
    title: `Not found · ${SITE_NAME}`,
    canonical: null,
    rootPrefix: basePath,
    body: `<h1>Page not found</h1>\n<p><a href="${escapeHtml(basePath)}">Go to the home page</a></p>`
  }));

  // Custom domain: GitHub Pages reads it from a CNAME file at the site root.
  // Writing it on every build means a publish run can never drop the domain.
  if (baseUrl) {
    const host = new URL(baseUrl).hostname;
    if (!host.endsWith('.github.io')) writeFile(outDir, 'CNAME', `${host}\n`);
  }
}

module.exports = { writeSite, escapeHtml };
