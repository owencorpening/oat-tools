'use strict';

// Checks from the pre-publish SOP (oat-standards
// sops/actions/sop-pre-publish-review.md, "Content — General") that a
// machine can run on every published article:
//
//   - "All URLs are live, not placeholders": a link with no real target, or a
//     bare Substack homepage link standing in for a specific article. The CTA
//     block's homepage link is the one permitted exception.
//   - "Sources section present": a Sources or References heading, bold line,
//     or <details><summary> block. LinkedIn posts are exempt.

const PLACEHOLDER_TARGETS = new Set(['', '#', 'link', 'url', 'todo', 'tbd', 'tk', 'xxx', 'placeholder', 'insert-link', 'link-here']);
const PLACEHOLDER_WORD = /(^|[^a-z])(todo|tbd|pending|placeholder|insert[ _-]?link)([^a-z]|$)/i;
// A bare word such as PENDING_URL or LINK can't be a real link target: real
// targets have a scheme, a path, a dot or an #anchor.
const BARE_WORD = /^[A-Za-z0-9_-]+$/;
const SUBSTACK_HOME = /^https?:\/\/owencorpening\.substack\.com\/?(?:[?#].*)?$/i;
const CTA_TEXT = /owen.s applied thinking|owencorpening\.substack\.com|subscribe/i;
const SOURCES = /^\s{0,3}(?:#{1,6}\s*|\*\*\s*|__\s*)?(?:sources|references)\b|<summary>[^<]*\b(?:sources|references)\b/im;
const NEEDS_SOURCES = new Set(['substack-article', 'linkedin-article']);

// Text of the [link text] that ends just before index `close` (a "]").
function linkTextBefore(body, close) {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    if (body[i] === ']') depth += 1;
    else if (body[i] === '[') {
      depth -= 1;
      if (depth === 0) return body.slice(i + 1, close);
    }
  }
  return '';
}

// Every link target in an article body, with its link text where there is
// one: inline [text](url), images, href="url", and reference definitions
// such as "[1]: https://...".
function extractLinks(body) {
  const links = [];
  let m;
  const inline = /\]\(\s*<?([^)\s>]*)>?[^)]*\)/g;
  while ((m = inline.exec(body)) !== null) {
    const isImage = body[body.lastIndexOf('[', m.index) - 1] === '!';
    links.push({ text: linkTextBefore(body, m.index), url: m[1], image: isImage });
  }
  const href = /\b(href|src)\s*=\s*["']([^"']*)["']/gi;
  while ((m = href.exec(body)) !== null) {
    links.push({ text: '', url: m[2], image: m[1].toLowerCase() === 'src' });
  }
  const refDef = /^\s{0,3}\[([^\]]+)\]:\s*<?(\S*?)>?(?:\s|$)/gm;
  while ((m = refDef.exec(body)) !== null) {
    links.push({ text: m[1], url: m[2], image: false });
  }
  return links;
}

function placeholderProblems(article) {
  const problems = [];
  for (const link of extractLinks(article.body)) {
    const url = link.url.trim();
    const label = link.text ? `[${link.text}](${url})` : url || '(empty link)';
    if (PLACEHOLDER_TARGETS.has(url.toLowerCase()) || PLACEHOLDER_WORD.test(url) || BARE_WORD.test(url)) {
      problems.push(`${article.tag}: placeholder link ${label}`);
    } else if (!link.image && SUBSTACK_HOME.test(url) && !CTA_TEXT.test(link.text)) {
      problems.push(`${article.tag}: link ${label} goes to the Substack homepage; it should point at a specific article`);
    }
  }
  return problems;
}

// Returns a problem string, or null when the article has its sources section
// or doesn't need one.
function sourcesProblem(article) {
  if (!NEEDS_SOURCES.has(article.type)) return null;
  if (SOURCES.test(article.body)) return null;
  return `${article.tag}: no Sources section (a "Sources" heading or a <details><summary>Sources</summary> block)`;
}

module.exports = { extractLinks, placeholderProblems, sourcesProblem };
