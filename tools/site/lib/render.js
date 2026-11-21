'use strict';

// Turns an article's Markdown into the HTML for its page body.
// No scripts: an article that carries <script>, <iframe>, <object>, <embed>
// or an inline event handler fails the build (the site has no JavaScript).

const { marked } = require('marked');

const ACTIVE_CONTENT = /<\s*(script|iframe|object|embed)\b|\son[a-z]+\s*=/i;
const SUBSTACK_POST = /^https?:\/\/owencorpening\.substack\.com\/p\/([A-Za-z0-9-]+)/;

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
  let html = marked.parse(dropLeadingTitle(article.body, article.title), { async: false });
  html = html.replace(/href="([^"]*)"/g, (all, url) => {
    const target = bySubstackSlug.get(substackSlug(url));
    if (target) return `href="${linkTo(target)}"`;
    return `href="${stripReferral(url)}"`;
  });
  return { html, problems };
}

// Plain-text first paragraph, for listings and link previews.
function firstParagraph(body, max = 220) {
  const blocks = dropLeadingTitle(body).split(/\n\s*\n/);
  for (const block of blocks) {
    const text = block
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_`|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 40) {
      return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text;
    }
  }
  return '';
}

module.exports = { renderBody, firstParagraph, substackSlug, stripReferral };
