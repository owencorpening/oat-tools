'use strict';

// Turns an article's Markdown into the HTML for its page body.
// No scripts: an article that carries <script>, <iframe>, <object>, <embed>
// or an inline event handler fails the build (the site has no JavaScript).

const { marked } = require('marked');
const { DEFAULT_SERIES } = require('./series');

const ACTIVE_CONTENT = /<\s*(script|iframe|object|embed)\b|\son[a-z]+\s*=/i;
const SUBSTACK_POST = /^https?:\/\/owencorpening\.substack\.com\/p\/([A-Za-z0-9-]+)/;

// Old Substack series-guide posts. The site's generated series pages replace
// them, so a link to one from a series article goes to that series' page.
const SERIES_GUIDE_SLUGS = new Set(['series-guide']);

function substackSlug(url) {
  const m = url ? SUBSTACK_POST.exec(url) : null;
  return m ? m[1].toLowerCase() : null;
}

// The page prints the title itself, so the article's own "# Title" line is
// dropped: the first line if it is an H1, or the first H1 matching the title.
function dropLeadingTitle(body, title) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const norm = (t) => t.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const first = lines.findIndex((l) => l.trim() !== '');
  let drop = first !== -1 && /^#\s+\S/.test(lines[first]) ? first : -1;
  if (drop === -1 && title) {
    drop = lines.findIndex((l) => /^#\s+\S/.test(l) && norm(l.slice(1)) === norm(title));
  }
  if (drop !== -1) lines.splice(drop, 1);
  return lines.join('\n');
}

// An <img> tag written across several lines, especially with its closing
// ">" on a line of its own, is not HTML to Markdown: it prints as text and the
// lone ">" becomes an empty quote. Joining each tag onto one line fixes that
// without touching the article's words.
function joinMultilineImgTags(body) {
  return body.replace(/<img\b[^>]*>/gi, (tag) => (tag.includes('\n') ? tag.replace(/\s+/g, ' ').replace(/\s+>$/, '>') : tag));
}

// github.com/<owner>/<repo>/blob/<ref>/<path>?raw=true is a redirect to the
// raw file; point straight at raw.githubusercontent.com so the build copies it.
function rawGithubUrl(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+?)(\?raw=true)?$/.exec(url);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url;
}

// Escaped tags in the page text mean raw HTML the Markdown parser did not
// recognise, which readers would see as code. Code samples are exempt.
const ESCAPED_TAG = /&lt;\/?(img|a|div|p|span|br|table|tr|td|th|figure|figcaption|details|summary|sup|sub|video|audio|source|picture|center|font|b|i|em|strong|hr|h[1-6]|ul|ol|li)\b/i;

function escapedHtmlProblem(html) {
  const text = html.replace(/<pre>[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>/g, '');
  const m = ESCAPED_TAG.exec(text);
  return m ? text.slice(m.index, m.index + 40).replace(/\s+/g, ' ') : null;
}

// Removes Substack referral codes such as ?r=1gha0n.
function stripReferral(url) {
  try {
    const u = new URL(url.replace(/&amp;/g, '&'));
    if (!/(^|\.)substack\.com$/.test(u.hostname) || !u.searchParams.has('r')) return url;
    u.searchParams.delete('r');
    return u.toString().replace(/&/g, '&amp;');
  } catch (err) {
    return url; // relative or unusual URL: leave it alone
  }
}

// `linkTo(article)` returns the relative URL of another article's page.
function renderBody(article, { bySubstackSlug, linkTo }) {
  const problems = [];
  if (ACTIVE_CONTENT.test(article.body)) {
    problems.push(`${article.tag}: contains a script, iframe, embed or inline event handler; the site has no JavaScript`);
  }
  let html = marked.parse(joinMultilineImgTags(dropLeadingTitle(article.body, article.title)), { async: false });
  html = html.replace(/<img\b[^>]*>/gi, (tag) => tag.replace(/src="([^"]*)"/, (all, url) => `src="${rawGithubUrl(url)}"`));
  const escaped = escapedHtmlProblem(html);
  if (escaped) problems.push(`${article.tag}: raw HTML would show as text ("${escaped}…"); fix the tag in the article`);
  html = html.replace(/href="([^"]*)"/g, (all, url) => {
    const slug = substackSlug(url);
    if (SERIES_GUIDE_SLUGS.has(slug) && article.series !== DEFAULT_SERIES) return 'href="../"';
    const target = bySubstackSlug.get(slug);
    if (target) return `href="${linkTo(target)}"`;
    return `href="${stripReferral(url)}"`;
  });
  return { html, problems };
}

// Plain-text first paragraph, for listings and link previews.
// The OAT brand block (oat-standards templates/brand_block.md) opens many
// articles. It is the same on every one, so it is never used as a caption.
const BRAND_BLOCK_LINES = new Set([
  'Exploring the hidden logic and overlooked systems of everyday life, from the perspective of an engineer.',
  // Current tagline plus the older one — existing articles still carry the old
  // brand block, so both must be recognized and skipped in caption extraction.
  "Where reasoning meets the real world.",
  "It's not activism. It's not theory. It's engineering."
]);

function isBrandLine(line) {
  const text = line.replace(/[*_]/g, '').replace(/[\u2018\u2019]/g, "'").trim();
  return BRAND_BLOCK_LINES.has(text);
}

function firstParagraph(body, max = 220) {
  const withoutBrand = dropLeadingTitle(body).split('\n').filter((line) => !isBrandLine(line)).join('\n');
  const blocks = withoutBrand.split(/\n\s*\n/);
  for (const block of blocks) {
    const text = block
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, ' ') // list markers
      .replace(/[#>*_`|]/g, ' ')
      .replace(/(^|\s)-+(?=\s|$)/g, ' ') // table rules and lone dashes, not hyphens in words
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 40) {
      return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text;
    }
  }
  return '';
}

module.exports = { renderBody, firstParagraph, substackSlug, stripReferral, SERIES_GUIDE_SLUGS };
