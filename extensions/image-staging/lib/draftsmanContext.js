'use strict';

// Auto-captures the paragraph surrounding the cursor for Flag Image's
// placeholder alt text. Deliberately not reusing findQuoteRange.js (solves
// "locate known text in the doc") or pullquoteSop.js (a file-path
// resolver) — neither covers "expand outward from a cursor line to its
// enclosing paragraph," which is genuinely new logic. Pure string/line
// functions, no VS Code dependency, so this is trivially unit-testable.

function isBlankLine(line) {
  return /^\s*$/.test(line);
}

function isHeadingLine(line) {
  return /^\s{0,3}#{1,6}\s/.test(line);
}

function isImageLine(line) {
  return /!\[[^\]]*\]\([^)]+\)/.test(line);
}

// Lines that can't themselves serve as "context" — a heading isn't prose,
// an existing image/marker line shouldn't get captured as its own context.
function isSkippableLine(line) {
  return isBlankLine(line) || isHeadingLine(line) || isImageLine(line);
}

function expandToParagraph(lines, lineIndex) {
  let start = lineIndex;
  while (start > 0 && !isBlankLine(lines[start - 1])) start--;
  let end = lineIndex;
  while (end < lines.length - 1 && !isBlankLine(lines[end + 1])) end++;
  return lines.slice(start, end + 1).join(' ');
}

function findNearestParagraphLine(lines, fromLine, direction) {
  let i = fromLine;
  while (i >= 0 && i < lines.length) {
    if (!isSkippableLine(lines[i])) return i;
    i += direction;
  }
  return -1;
}

function captureSurroundingParagraph(documentText, cursorLine) {
  const lines = String(documentText || '').split(/\r?\n/);
  if (lines.length === 0) return '';

  const clampedCursor = Math.max(0, Math.min(cursorLine, lines.length - 1));

  let targetLine = clampedCursor;
  if (isSkippableLine(lines[targetLine] || '')) {
    // Prefer the nearest preceding real paragraph (what the author was
    // just reading), fall forward only if there's nothing before it.
    targetLine = findNearestParagraphLine(lines, clampedCursor, -1);
    if (targetLine === -1) targetLine = findNearestParagraphLine(lines, clampedCursor, 1);
    if (targetLine === -1) return '';
  }

  return expandToParagraph(lines, targetLine).replace(/\s+/g, ' ').trim();
}

module.exports = { captureSurroundingParagraph };
