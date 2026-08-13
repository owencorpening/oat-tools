#!/usr/bin/env node
/**
 * blockiness-report.js
 *
 * Scores markdown articles for "text-blockiness" — how much unbroken
 * prose sits between visual breaks (headings, images, tables, blockquotes,
 * code fences, horizontal rules, or existing pullquotes).
 *
 * Purpose: triage a backlog of published articles to find which ones
 * would benefit most from add-pullquotes, before reprocessing everything.
 *
 * Usage:
 *   node blockiness-report.js <file-or-directory> [--json] [--pullquote-marker=">>"]
 *     [--classify-lists] [--model=claude-sonnet-5]
 *
 * Exit behavior: prints a human-readable report by default; --json emits
 * machine-readable output suitable for piping into the VS Code extension
 * or a CI step.
 *
 * --classify-lists is a separate, opt-in pass: for every bullet list found,
 * it calls Claude (via `claude -p`, drawing on your Claude Code login rather
 * than a separate API key — see classifyLists.js) against
 * oat-standards/sops/guardrails/sop-bullet-list-classification.md to flag
 * lists that are actually disguised tables/arguments/paragraphs and suggest
 * a conversion. Unlike the rest of this report, it's not instant or free —
 * one model call per list — and it never edits the article; it only prints
 * suggestions for manual review.
 */

const fs = require('fs');
const path = require('path');
const { classifyListBlock } = require('./classifyLists');

// ---- Configuration -------------------------------------------------------

const DEFAULT_PULLQUOTE_MARKER = '>>'; // adjust to match your SOP's syntax
const WORDS_PER_MINUTE = 200; // rough reading-speed constant, informational only

// ---- Block classification -------------------------------------------------

/**
 * Splits raw markdown into blocks on blank-line boundaries, then classifies
 * each block. A "break" block is anything that visually interrupts a wall
 * of text: headings, images, tables, blockquotes, code fences, hr, or an
 * existing pullquote marker. Everything else with real word content is a
 * "text" block.
 */
function parseBlocks(markdown) {
  const rawBlocks = markdown.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const blocks = [];
  let lineCursor = 1;

  for (const raw of rawBlocks) {
    const lineCount = raw.split('\n').length;
    const startLine = lineCursor;
    lineCursor += lineCount + 1; // +1 for the blank line separator

    blocks.push({
      raw,
      startLine,
      type: classifyBlock(raw),
      wordCount: countWords(raw),
    });
  }
  return blocks;
}

function classifyBlock(raw, pullquoteMarker = DEFAULT_PULLQUOTE_MARKER) {
  const firstLine = raw.split('\n')[0].trim();

  if (/^#{1,6}\s/.test(firstLine)) return 'heading';
  // HTML figure/img blocks — the actual image/pullquote convention this
  // repo's SOPs use (<figure><img class="oat-pullquote" ...></figure>),
  // not markdown ![]() syntax. Check the class on the whole block, not
  // just firstLine, since it's usually on a nested <img>, not <figure>.
  if (/^<figure[\s>]/i.test(firstLine) || /^<img[\s>]/i.test(firstLine)) {
    return /oat-pullquote/i.test(raw) ? 'pullquote' : 'image';
  }
  if (/^!\[.*?\]\(.*?\)/.test(firstLine)) return 'image';
  if (/^\|.*\|/.test(firstLine) && /^\|[\s:-]+\|/.test(raw.split('\n')[1] || '')) return 'table';
  if (/^>/.test(firstLine) && !firstLine.startsWith(pullquoteMarker)) return 'blockquote';
  if (firstLine.startsWith(pullquoteMarker)) return 'pullquote';
  if (/^```/.test(firstLine)) return 'code';
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(firstLine)) return 'hr';
  if (isListLine(firstLine)) return 'list';
  // A bold or plain "Label:" line glued directly to its list (no blank
  // line between them — this repo's articles do this constantly, e.g.
  // "**Economic Success:**\n✅ item\n✅ item") is still visually a list,
  // not a wall of prose. Without this, every labeled ✅/❌ list in the
  // corpus scores as dense unbroken text instead of a break.
  const secondLine = (raw.split('\n')[1] || '').trim();
  if (isLabelLine(firstLine) && isListLine(secondLine)) return 'list';

  return 'text';
}

function isListLine(line) {
  return /^(\*|-|\+|\d+\.|[✅❌])\s/.test(line);
}

function isLabelLine(line) {
  return /^(\*\*[^*]+\*\*:?|[A-Za-z][A-Za-z0-9 /'-]*:)\s*$/.test(line);
}

function countWords(raw) {
  // Strip markdown syntax noise before counting so scores aren't skewed
  // by link URLs, image alt-text brackets, etc.
  const stripped = raw
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`]/g, '');
  const words = stripped.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

// A block counts as a "break" for blockiness purposes if it's anything
// other than plain text or a list (lists are dense but don't visually
// break up prose the way an image/table/heading/pullquote does).
const BREAK_TYPES = new Set(['heading', 'image', 'table', 'blockquote', 'pullquote', 'code', 'hr']);

// ---- Scoring ---------------------------------------------------------------

function scoreFile(markdown, filePath, pullquoteMarker) {
  const blocks = parseBlocks(markdown);

  let longestRunBlocks = 0;
  let longestRunWords = 0;
  let currentRunBlocks = 0;
  let currentRunWords = 0;
  let worstStretch = null;
  let runStartBlock = null;

  const totalWords = blocks.reduce((sum, b) => sum + b.wordCount, 0);
  const textParagraphs = blocks.filter((b) => b.type === 'text');
  const breakBlocks = blocks.filter((b) => BREAK_TYPES.has(b.type));
  const existingPullquotes = blocks.filter((b) => b.type === 'pullquote').length;
  const headings = blocks.filter((b) => b.type === 'heading').length;

  for (const block of blocks) {
    const isBreak = BREAK_TYPES.has(block.type);

    if (!isBreak && block.type !== 'list') {
      if (currentRunBlocks === 0) runStartBlock = block;
      currentRunBlocks += 1;
      currentRunWords += block.wordCount;
    } else if (isBreak) {
      if (currentRunWords > longestRunWords) {
        longestRunWords = currentRunWords;
        longestRunBlocks = currentRunBlocks;
        worstStretch = runStartBlock
          ? { startLine: runStartBlock.startLine, words: currentRunWords, blocks: currentRunBlocks }
          : null;
      }
      currentRunBlocks = 0;
      currentRunWords = 0;
      runStartBlock = null;
    }
    // 'list' blocks neither extend nor break a run — treated as neutral.
  }
  // Flush a trailing run that reaches end-of-file without a break.
  if (currentRunWords > longestRunWords) {
    longestRunWords = currentRunWords;
    longestRunBlocks = currentRunBlocks;
    worstStretch = runStartBlock
      ? { startLine: runStartBlock.startLine, words: currentRunWords, blocks: currentRunBlocks }
      : null;
  }

  const avgParagraphWords = textParagraphs.length
    ? textParagraphs.reduce((s, b) => s + b.wordCount, 0) / textParagraphs.length
    : 0;

  const variance = textParagraphs.length
    ? textParagraphs.reduce((s, b) => s + (b.wordCount - avgParagraphWords) ** 2, 0) / textParagraphs.length
    : 0;

  const breakDensityPer1000Words = totalWords > 0 ? (breakBlocks.length / totalWords) * 1000 : 0;
  const wordsPerHeading = headings > 0 ? totalWords / headings : totalWords;

  // Composite score: primarily driven by the worst unbroken stretch,
  // since that's the single spot a reader is most likely to bounce off.
  // Scaled 0-100+, no hard ceiling — higher means blockier.
  const blockinessScore = Math.round(
    (longestRunWords / 150) * 40 +           // worst stretch, weighted heaviest
    (100 - Math.min(breakDensityPer1000Words * 10, 100)) * 0.3 + // sparse breaks penalized
    Math.min(wordsPerHeading / 50, 30)        // long heading-free sections penalized
  );

  return {
    file: filePath,
    totalWords,
    blockinessScore,
    longestUnbrokenStretch: { words: longestRunWords, paragraphs: longestRunBlocks },
    worstStretchStartLine: worstStretch ? worstStretch.startLine : null,
    avgParagraphWords: Math.round(avgParagraphWords),
    paragraphWordVariance: Math.round(variance),
    breakDensityPer1000Words: Math.round(breakDensityPer1000Words * 10) / 10,
    headingCount: headings,
    wordsPerHeading: Math.round(wordsPerHeading),
    existingPullquotes,
    estimatedReadMinutes: Math.round(totalWords / WORDS_PER_MINUTE),
  };
}

// ---- Bullet list classification (opt-in, --classify-lists) ----------------

// Gathers, for every 'list' block: the preceding block's raw text (context
// for the model) and, if the very next block is also a list, its items too
// (so PATTERN_C's opposing-list pairing — success/failure, pro/con — has
// something to actually detect against). Both lists in a pair are still
// classified independently; nothing here merges them.
function findListBlocksWithContext(blocks) {
  const found = [];
  blocks.forEach((block, i) => {
    if (block.type !== 'list') return;
    const preceding = i > 0 ? blocks[i - 1] : null;
    const next = i < blocks.length - 1 ? blocks[i + 1] : null;
    found.push({
      startLine: block.startLine,
      listItems: block.raw,
      precedingContext: preceding ? preceding.raw : null,
      pairedListItems: next && next.type === 'list' ? next.raw : null,
    });
  });
  return found;
}

async function classifyListsInFile(markdown, filePath, options = {}) {
  const blocks = parseBlocks(markdown);
  const candidates = findListBlocksWithContext(blocks);
  const results = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    process.stderr.write(
      `  Classifying list ${i + 1}/${candidates.length} (line ${c.startLine}) in ${filePath}...\n`
    );
    try {
      const classification = await classifyListBlock(c, options);
      results.push({ startLine: c.startLine, ...classification });
    } catch (err) {
      results.push({ startLine: c.startLine, error: err.message });
    }
  }
  return results;
}

// ---- File discovery ---------------------------------------------------------

function collectMarkdownFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];

  const results = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      results.push(...collectMarkdownFiles(full));
    } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ---- Report rendering ---------------------------------------------------------

function renderHumanReport(results) {
  const sorted = [...results].sort((a, b) => b.blockinessScore - a.blockinessScore);
  const lines = [];
  lines.push('');
  lines.push('TEXT-BLOCKINESS REPORT');
  lines.push('='.repeat(60));

  for (const r of sorted) {
    lines.push('');
    lines.push(`${r.file}`);
    lines.push(`  Blockiness score:        ${r.blockinessScore}`);
    lines.push(`  Worst unbroken stretch:  ${r.longestUnbrokenStretch.words} words across ${r.longestUnbrokenStretch.paragraphs} paragraphs${r.worstStretchStartLine ? ` (starts ~line ${r.worstStretchStartLine})` : ''}`);
    lines.push(`  Avg paragraph length:    ${r.avgParagraphWords} words (variance ${r.paragraphWordVariance})`);
    lines.push(`  Break density:           ${r.breakDensityPer1000Words} breaks / 1000 words`);
    lines.push(`  Headings:                ${r.headingCount} (${r.wordsPerHeading} words/heading)`);
    lines.push(`  Existing pullquotes:     ${r.existingPullquotes}`);
    lines.push(`  Est. read time:          ${r.estimatedReadMinutes} min (${r.totalWords} words)`);

    if (r.listClassifications && r.listClassifications.length > 0) {
      lines.push('');
      lines.push('  Bullet list conversion suggestions:');
      for (const c of r.listClassifications) {
        if (c.error) {
          lines.push(`    Line ${c.startLine}: ERROR — ${c.error}`);
          continue;
        }
        lines.push(`    Line ${c.startLine}: PATTERN_${c.pattern} → ${c.verdict} (confidence: ${c.confidence})`);
        lines.push(`      ${c.reasoning}`);
        if (c.pairedListId) lines.push(`      Paired with: ${c.pairedListId}`);
        if (c.convertedOutput) {
          lines.push('      Suggested conversion:');
          c.convertedOutput.split('\n').forEach((l) => lines.push(`        ${l}`));
        }
      }
    }
  }

  lines.push('');
  lines.push('-'.repeat(60));
  lines.push(`Ranked by blockiness (highest first) — top candidates for add-pullquotes:`);
  sorted.slice(0, 5).forEach((r, i) => lines.push(`  ${i + 1}. ${r.file}  (score ${r.blockinessScore})`));
  lines.push('');

  return lines.join('\n');
}

// ---- CLI entry point ---------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  const jsonOutput = args.includes('--json');
  const classifyLists = args.includes('--classify-lists');
  const markerArg = args.find((a) => a.startsWith('--pullquote-marker='));
  const pullquoteMarker = markerArg ? markerArg.split('=')[1] : DEFAULT_PULLQUOTE_MARKER;
  const modelArg = args.find((a) => a.startsWith('--model='));
  const model = modelArg ? modelArg.split('=')[1] : 'claude-sonnet-5';

  if (!target) {
    console.error('Usage: node blockiness-report.js <file-or-directory> [--json] [--pullquote-marker=">>"] [--classify-lists] [--model=claude-sonnet-5]');
    process.exit(1);
  }

  const files = collectMarkdownFiles(target);
  if (files.length === 0) {
    console.error(`No markdown files found at: ${target}`);
    process.exit(1);
  }

  const results = files.map((f) => scoreFile(fs.readFileSync(f, 'utf8'), f, pullquoteMarker));

  if (classifyLists) {
    process.stderr.write(`Classifying bullet lists across ${files.length} file(s) — one Claude call per list, this may take a while...\n`);
    for (const result of results) {
      const markdown = fs.readFileSync(result.file, 'utf8');
      result.listClassifications = await classifyListsInFile(markdown, result.file, { model });
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(renderHumanReport(results));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  scoreFile, parseBlocks, classifyBlock, collectMarkdownFiles,
  findListBlocksWithContext, classifyListsInFile
};
