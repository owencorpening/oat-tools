'use strict';

// Locates a model-returned quote inside the document text, searching only
// from fromOffset forward (so "Find Next" never re-surfaces something
// earlier in the document). Tries an exact substring match first, then falls
// back to a whitespace-tolerant match — a model can normalize a line-wrapped
// quote's internal newlines to spaces even when told to return it verbatim.
function findQuoteRange(text, quote, fromOffset = 0) {
  if (!quote) return null;
  const haystack = text.slice(fromOffset);

  const exactIdx = haystack.indexOf(quote);
  if (exactIdx !== -1) {
    return { start: fromOffset + exactIdx, end: fromOffset + exactIdx + quote.length };
  }

  const words = quote.split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) return null;

  const match = new RegExp(words.join('\\s+')).exec(haystack);
  if (!match) return null;

  return { start: fromOffset + match.index, end: fromOffset + match.index + match[0].length };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { findQuoteRange };
