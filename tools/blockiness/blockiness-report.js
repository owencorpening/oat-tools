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
 *
 * Exit behavior: prints a human-readable report by default; --json emits
 * machine-readable output suitable for piping into the VS Code extension
 * or a CI step.
 */

const fs = require('fs');
const path = require('path');

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
  if (/^!\[.*?\]\(.*?\)/.test(firstLine)) return 'image';
  if (/^\|.*\|/.test(firstLine) && /^\|[\s:-]+\|/.test(raw.split('\n')[1] || '')) return 'table';
  if (/^>/.test(firstLine) && !firstLine.startsWith(pullquoteMarker)) return 'blockquote';
  if (firstLine.startsWith(pullquoteMarker)) return 'pullquote';
  if (/^```/.test(firstLine)) return 'code';
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(firstLine)) return 'hr';
  if (/^(\*|-|\+|\d+\.)\s/.test(firstLine)) return 'list';

  return 'text';
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
  }

  lines.push('');
  lines.push('-'.repeat(60));
  lines.push(`Ranked by blockiness (highest first) — top candidates for add-pullquotes:`);
  sorted.slice(0, 5).forEach((r, i) => lines.push(`  ${i + 1}. ${r.file}  (score ${r.blockinessScore})`));
  lines.push('');

  return lines.join('\n');
}

// ---- CLI entry point ---------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  const jsonOutput = args.includes('--json');
  const markerArg = args.find((a) => a.startsWith('--pullquote-marker='));
  const pullquoteMarker = markerArg ? markerArg.split('=')[1] : DEFAULT_PULLQUOTE_MARKER;

  if (!target) {
    console.error('Usage: node blockiness-report.js <file-or-directory> [--json] [--pullquote-marker=">>"]');
    process.exit(1);
  }

  const files = collectMarkdownFiles(target);
  if (files.length === 0) {
    console.error(`No markdown files found at: ${target}`);
    process.exit(1);
  }

  const results = files.map((f) => scoreFile(fs.readFileSync(f, 'utf8'), f, pullquoteMarker));

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(renderHumanReport(results));
  }
}

if (require.main === module) {
  main();
}

module.exports = { scoreFile, parseBlocks, classifyBlock, collectMarkdownFiles };
