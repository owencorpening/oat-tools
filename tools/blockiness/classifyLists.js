'use strict';

const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_SOP_PATH = path.join(
  os.homedir(), 'dev', 'oat-standards', 'sops', 'guardrails', 'sop-bullet-list-classification.md'
);

// Runs headless via `claude -p`, same mechanism as the image-staging
// extension's pullquote suggestions (lib/claudeCliClient.js) — draws on
// the caller's Claude Code login/subscription, not a separate API key.
function callClaudeCli({ model, systemPromptFile, userText, cliBin = 'claude' } = {}, { spawnFn = spawn } = {}) {
  if (!systemPromptFile) {
    return Promise.reject(new Error('System prompt file path required.'));
  }

  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence',
    '--system-prompt-file', systemPromptFile,
    '--model', model
  ];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(cliBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new Error(`Could not launch '${cliBin}' — is Claude Code installed and on PATH? (${err.message})`));
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => {
      reject(new Error(`Could not launch '${cliBin}' — is Claude Code installed and on PATH? (${err.message})`));
    });
    child.on('close', code => {
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(new Error(`claude CLI returned non-JSON output (exit ${code}): ${(stdout || stderr).slice(0, 200)}`));
        return;
      }
      if (parsed.is_error) {
        reject(new Error(parsed.result || `claude CLI reported an error (exit ${code}).`));
        return;
      }
      resolve(parsed.result);
    });

    child.stdin.write(userText);
    child.stdin.end();
  });
}

// Extracts the outermost {...} object from a model response, stripping a
// markdown fence if present. Does NOT touch escaping — the model's own
// escaping may already be valid JSON (e.g. it correctly double-escapes a
// literal backslash as \\), so mangling it here unconditionally would
// corrupt already-correct output. See sanitizeInvalidEscapes for the
// fallback repair, applied only if a raw parse fails.
function extractJson(text) {
  const trimmed = String(text || '').trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;
  return candidate.slice(firstBrace, lastBrace + 1);
}

// Doubles any backslash that isn't starting a real JSON escape — repairs
// the common case of article text carrying a markdown escape like \$3
// billion verbatim into a JSON string, which is invalid JSON as a single
// backslash. Only ever applied as a fallback after a raw JSON.parse has
// already failed, specifically because it's unsafe to apply unconditionally
// (see extractJson) — it would double an already-valid \\ into \\\\.
function sanitizeInvalidEscapes(jsonText) {
  return jsonText.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

const VALID_VERDICTS = new Set([
  'KEEP_AS_BULLETS', 'SPEC_TABLE', 'CONVERT_TO_TABLE',
  'CONVERT_TO_COMPARISON', 'CONVERT_TO_PROSE', 'PULLQUOTE_STRONGEST'
]);

function parseClassification(responseText) {
  const jsonText = extractJson(responseText);
  if (!jsonText) return null;
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    try {
      parsed = JSON.parse(sanitizeInvalidEscapes(jsonText));
    } catch {
      return null;
    }
  }
  if (!VALID_VERDICTS.has(parsed.verdict)) return null;
  return {
    pattern: parsed.pattern || null,
    verdict: parsed.verdict,
    confidence: parsed.confidence || null,
    reasoning: parsed.reasoning || null,
    pairedListId: parsed.paired_list_id ?? null,
    convertedOutput: parsed.converted_output ?? null
  };
}

function buildUserText({ listItems, precedingContext, pairedListItems }) {
  const parts = [];
  parts.push('Classify the following bullet list per the SOP above.');
  parts.push('');
  parts.push('--- PRECEDING CONTEXT (heading or sentence before the list) ---');
  parts.push(precedingContext ? precedingContext.trim() : '(none — list is at the start of a section with no lead-in)');
  parts.push('');
  parts.push('--- LIST TO CLASSIFY ---');
  parts.push(listItems.trim());
  if (pairedListItems) {
    parts.push('');
    parts.push('--- POSSIBLE PAIRED LIST (appears immediately after — for PATTERN_C opposing-list detection only) ---');
    parts.push(pairedListItems.trim());
  }
  return parts.join('\n');
}

// options: { model, cliBin, systemPromptFile }
async function classifyListBlock({ listItems, precedingContext, pairedListItems }, options = {}) {
  const {
    model = 'claude-sonnet-5',
    cliBin = 'claude',
    systemPromptFile = DEFAULT_SOP_PATH,
    callClaudeCliFn = callClaudeCli
  } = options;

  const userText = buildUserText({ listItems, precedingContext, pairedListItems });
  const responseText = await callClaudeCliFn({ model, systemPromptFile, userText, cliBin });
  const parsed = parseClassification(responseText);
  if (!parsed) {
    throw new Error(`Could not parse model response as a classification: ${String(responseText).slice(0, 400)}`);
  }
  return parsed;
}

module.exports = {
  classifyListBlock, callClaudeCli, parseClassification, extractJson,
  sanitizeInvalidEscapes, DEFAULT_SOP_PATH
};
