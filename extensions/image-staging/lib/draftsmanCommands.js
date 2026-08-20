'use strict';

const { registerDraftsmanFlagCommand } = require('./draftsmanFlagCommand');
const { registerDraftsmanSweepCommand } = require('./draftsmanSweepCommand');
const { registerDraftsmanReviewCommand } = require('./draftsmanReviewCommand');
const { registerDraftsmanDecoration } = require('./draftsmanDecoration');

// Single entry point extension.js calls — kept as separate files above for
// testability/readability, unified under one registration call here.
function registerDraftsmanCommands(context, vscode, options = {}) {
  registerDraftsmanFlagCommand(context, vscode, options);
  registerDraftsmanSweepCommand(context, vscode, options);
  registerDraftsmanReviewCommand(context, vscode, options);
  registerDraftsmanDecoration(context, vscode);
}

module.exports = { registerDraftsmanCommands };
