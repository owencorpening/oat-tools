'use strict';

const HEADING_RE = /^#{1,6}\s/;

function parseBlockquotes(text) {
  const lines = text.split('\n');
  const blockquotes = [];
  let i = 0;

  while (i < lines.length) {
    if (!isBlockquoteLine(lines[i])) { i++; continue; }

    const startLine = i;
    const block = [];
    while (i < lines.length && isBlockquoteLine(lines[i])) {
      block.push(stripMarker(lines[i]));
      i++;
    }
    const endLine = i - 1;

    const text = stripEmphasis(block.filter(Boolean).join(' ').trim());
    if (!text) continue;

    blockquotes.push({ startLine, endLine, text, skipReason: detectSkipReason(block) });
  }

  return blockquotes;
}

// A pullquote is one continuous thought — at most a couple of sentences,
// occasionally split into two blank-line-separated parts for readability. A
// structural callout (e.g. an Executive Summary box) reads as its own
// mini-document instead: it has a heading of its own, and/or several
// sub-paragraphs. Either signal is enough to flag it as "not a pullquote."
function detectSkipReason(block) {
  const firstNonEmpty = block.find(line => line.trim() !== '');
  if (firstNonEmpty && HEADING_RE.test(firstNonEmpty.trim())) {
    return 'heading';
  }

  // Allow up to two parts (a short quote split for readability); three or
  // more reads as a genuinely multi-paragraph structural block.
  if (countParagraphs(block) > 2) {
    return 'multi-paragraph';
  }

  return null;
}

function countParagraphs(block) {
  let count = 0;
  let inParagraph = false;
  for (const line of block) {
    if (line.trim() !== '') {
      if (!inParagraph) count++;
      inParagraph = true;
    } else {
      inParagraph = false;
    }
  }
  return count;
}

function isBlockquoteLine(line) {
  return line.trimStart().startsWith('>');
}

function stripMarker(line) {
  return line.trimStart().replace(/^>\s?/, '');
}

function stripEmphasis(text) {
  return text
    .replace(/\*+([^*]+)\*+/g, '$1')
    .replace(/_+([^_]+)_+/g, '$1');
}

module.exports = { parseBlockquotes };
