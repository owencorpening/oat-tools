'use strict';
const vscode = require('vscode');
const { ImagePanelProvider } = require('./views/imagePanelProvider');
const { registerLedgerBrowseCommands } = require('./lib/ledgerBrowseCommands');
const { registerExecutePlannedPlacementCommand } = require('./lib/executePlannedPlacementCommand');
const { registerLocalFileIntakeCommand } = require('./lib/localFileIntakeCommand');
const { createLedgerWriterFromSettings } = require('./lib/ledgerApiClient');
const { registerPlannedPlacementRunCommand } = require('./lib/plannedPlacementRunCommand');
const { registerReviewImageNeedCommand } = require('./lib/reviewImageNeedCommand');
const { registerUrlIntakeCommand } = require('./lib/urlIntakeCommand');

function activate(context) {
  console.log('[OAT] Extension activating...');
  const ledgerWriter = createLedgerWriterFromSettings(vscode);
  console.log('[OAT] Ledger writer created:', !!ledgerWriter);
  const imagePanel = new ImagePanelProvider(context, { ledgerWriter });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ImagePanelProvider.viewId, imagePanel)
  );
  console.log('[OAT] Webview provider registered');

  context.subscriptions.push(
    vscode.commands.registerCommand('oatImages.refreshPanel', () => imagePanel.refresh())
  );

  registerLocalFileIntakeCommand(context, vscode, { ledgerWriter });
  registerReviewImageNeedCommand(context, vscode, { ledgerWriter });
  registerUrlIntakeCommand(context, vscode, { ledgerWriter });
  registerLedgerBrowseCommands(context, vscode, { ledgerWriter });
  registerExecutePlannedPlacementCommand(context, vscode, { ledgerWriter });
  registerPlannedPlacementRunCommand(context, vscode, { ledgerWriter });
}

function deactivate() {}

module.exports = { activate, deactivate };
