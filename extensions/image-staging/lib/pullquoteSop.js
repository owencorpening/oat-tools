'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function pullquoteSopPath(vscode) {
  const configured = vscode.workspace.getConfiguration('oatImages').get('pullquoteSopPath', '');
  if (configured) return configured;
  return path.join(os.homedir(), 'dev', 'oat-standards', 'sops', 'sop-pullquote-selection.md');
}

// Returns the SOP path after confirming it exists — the CLI reads the file
// itself via --system-prompt-file, so the extension no longer needs the
// content in memory.
function resolvePullquoteSopPath(vscode, { existsSync = fs.existsSync } = {}) {
  const sopPath = pullquoteSopPath(vscode);
  if (!existsSync(sopPath)) {
    throw new Error(`Could not find pullquote SOP at ${sopPath}`);
  }
  return sopPath;
}

module.exports = { pullquoteSopPath, resolvePullquoteSopPath };
