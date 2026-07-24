'use strict';

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
    if (text) blockquotes.push({ startLine, endLine, text });
  }

  return blockquotes;
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
