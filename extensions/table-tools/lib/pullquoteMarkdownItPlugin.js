'use strict';

// Wraps pullquote <img class="oat-pullquote"> tags (inserted by promotePullquote /
// promoteAllPullquotes in extension.js) in a command: URI link, so clicking the
// rendered image in VS Code's built-in Markdown preview jumps back to the source
// selection instead of doing nothing. Table images and any other raw <img> HTML
// are left untouched.

const PULLQUOTE_IMG = /<img\b[^>]*\bclass="oat-pullquote"[^>]*>/g;
const ALT_ATTR = /\balt="([^"]*)"/;

function wrapPullquoteImages(content) {
  return content.replace(PULLQUOTE_IMG, imgTag => {
    const altMatch = ALT_ATTR.exec(imgTag);
    if (!altMatch) return imgTag;

    const quoteText = unescapeHtml(altMatch[1]);
    const args = encodeURIComponent(JSON.stringify([quoteText]));
    return `<a href="command:oatTables.jumpToPullquoteSource?${args}" title="Jump to source">${imgTag}</a>`;
  });
}

// Inverse of escapeHtml() in extension.js — decode narrower entities first so a
// literal "&amp;" in the source text isn't corrupted by decoding it too early.
function unescapeHtml(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

module.exports = function pullquoteMarkdownItPlugin(md) {
  for (const ruleName of ['html_block', 'html_inline']) {
    const defaultRule =
      md.renderer.rules[ruleName] ||
      ((tokens, idx) => tokens[idx].content);

    md.renderer.rules[ruleName] = (tokens, idx, options, env, self) => {
      const rendered = defaultRule(tokens, idx, options, env, self);
      return wrapPullquoteImages(rendered);
    };
  }

  return md;
};
