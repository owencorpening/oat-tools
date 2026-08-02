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
  if (words.length > 0) {
    const match = new RegExp(words.join('\\s+')).exec(haystack);
    if (match) {
      return { start: fromOffset + match.index, end: fromOffset + match.index + match[0].length };
    }
  }

  // A model asked to copy a span "verbatim" still routinely strips markdown
  // emphasis (**bold**, _italic_) it reads as formatting rather than content.
  // Retry against emphasis-stripped text, then map the match back onto the
  // original (unstripped) offsets so the caller still gets real doc text.
  const { normalized, map } = stripEmphasisMarkers(haystack);
  const normQuote = stripEmphasisMarkers(quote).normalized;
  if (!normQuote || map.length === 0) return null;

  let normStart = normalized.indexOf(normQuote);
  let normEnd;
  if (normStart !== -1) {
    normEnd = normStart + normQuote.length;
  } else {
    const normWords = normQuote.split(/\s+/).filter(Boolean).map(escapeRegExp);
    if (normWords.length === 0) return null;
    const normMatch = new RegExp(normWords.join('\\s+')).exec(normalized);
    if (!normMatch) return null;
    normStart = normMatch.index;
    normEnd = normMatch.index + normMatch[0].length;
  }

  const origStart = map[normStart];
  const origEnd = normEnd - 1 < map.length ? map[normEnd - 1] + 1 : haystack.length;
  return { start: fromOffset + origStart, end: fromOffset + origEnd };
}

// Drops '*' and '_' markdown emphasis characters while keeping a per-index
// map back to their position in the original string.
function stripEmphasisMarkers(str) {
  let normalized = '';
  const map = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '*' || ch === '_') continue;
    normalized += ch;
    map.push(i);
  }
  return { normalized, map };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { findQuoteRange };
