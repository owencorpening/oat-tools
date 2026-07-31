'use strict';

const { spawn } = require('child_process');

const DEFAULT_CLI_BIN = 'claude';

// spawnFn is injectable so callers/tests don't have to launch a real process —
// mirrors the request injection pattern in ledgerApiClient.js. Runs headless
// via `claude -p`, which authenticates with the caller's Claude Code login and
// draws against their subscription usage rather than a separate API key.
function callClaudeCli({
  model,
  systemPromptFile,
  userText,
  cliBin = DEFAULT_CLI_BIN
} = {}, { spawnFn = spawn } = {}) {
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

module.exports = { callClaudeCli, DEFAULT_CLI_BIN };
