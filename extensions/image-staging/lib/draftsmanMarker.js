'use strict';

// Single source of truth for the Draftsman marker's shape. Sweep's grep,
// the editor decoration's regex, and Review's cursor-line detection all
// read from this file rather than maintaining their own copies — keeps
// "what counts as a placeholder" defined in exactly one place.

const PLACEHOLDER_FILENAME = 'placeholder-image-needed.png';
const PLACEHOLDER_REL_PATH = '.draftsman/placeholder-image-needed.png';

// Matches a full placeholder markdown-image line, capturing the alt-text
// context snippet.
const PLACEHOLDER_LINE_RE = /!\[TODO:IMG "([^"]*)"\]\(\.draftsman\/placeholder-image-needed\.png\)/;

// Matches ANY Draftsman-authored image line — placeholder or already
// resolved (stock or generated) — since the marker syntax is deliberately
// identical in both states. Used by Review's cursor-line detection.
const IMAGE_LINE_RE = /!\[([^\]]*)\]\(([^)]+)\)/;

const MAX_CONTEXT_LENGTH = 200;

function escapeAltText(text) {
  return String(text || '')
    .replace(/"/g, "'")
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateContext(text, maxLength = MAX_CONTEXT_LENGTH) {
  const clean = String(text || '').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trim()}…`;
}

function buildPlaceholderLine(contextSnippet) {
  const context = escapeAltText(truncateContext(contextSnippet));
  return `![TODO:IMG "${context}"](${PLACEHOLDER_REL_PATH})`;
}

function parsePlaceholderLine(lineText) {
  const match = PLACEHOLDER_LINE_RE.exec(lineText || '');
  if (!match) return null;
  return { context: match[1] };
}

function parseImageLine(lineText) {
  const match = IMAGE_LINE_RE.exec(lineText || '');
  if (!match) return null;
  const [, alt, srcRaw] = match;
  const src = srcRaw.trim();
  return { alt, src, isPlaceholder: src === PLACEHOLDER_REL_PATH };
}

module.exports = {
  PLACEHOLDER_FILENAME,
  PLACEHOLDER_REL_PATH,
  PLACEHOLDER_LINE_RE,
  IMAGE_LINE_RE,
  MAX_CONTEXT_LENGTH,
  buildPlaceholderLine,
  parsePlaceholderLine,
  parseImageLine,
  escapeAltText,
  truncateContext
};
