'use strict';
const vscode = require('vscode');
const { ImagePanelProvider } = require('./views/imagePanelProvider');
const { registerLedgerBrowseCommands } = require('./lib/ledgerBrowseCommands');
const { registerLocalFileIntakeCommand } = require('./lib/localFileIntakeCommand');
const { createLedgerWriterFromSettings } = require('./lib/ledgerApiClient');
const { registerReviewImageNeedCommand } = require('./lib/reviewImageNeedCommand');
const { registerUrlIntakeCommand } = require('./lib/urlIntakeCommand');

function activate(context) {
  const ledgerWriter = createLedgerWriterFromSettings(vscode);
  const imagePanel = new ImagePanelProvider(context, { ledgerWriter });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ImagePanelProvider.viewId, imagePanel)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('oatImages.refreshPanel', () => imagePanel.refresh())
  );

  registerLocalFileIntakeCommand(context, vscode, { ledgerWriter });
  registerReviewImageNeedCommand(context, vscode, { ledgerWriter });
  registerUrlIntakeCommand(context, vscode, { ledgerWriter });
  registerLedgerBrowseCommands(context, vscode, { ledgerWriter });
}

function deactivate() {}

module.exports = { activate, deactivate };
