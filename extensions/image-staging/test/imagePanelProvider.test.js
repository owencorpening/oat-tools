'use strict';

const assert = require('assert');
const Module = require('module');

const infoMessages = [];
const warningMessages = [];
const quickPickValues = [];
const inputBoxValues = [];
const fakeVscode = {
  window: {
    activeTextEditor: null,
    showInformationMessage: async message => {
      infoMessages.push(message);
      return message;
    },
    showWarningMessage: async message => {
      warningMessages.push(message);
      return message;
    },
    showQuickPick: async () => quickPickValues.shift(),
    showInputBox: async () => inputBoxValues.shift()
  },
  workspace: {
    getConfiguration: () => ({
      get: () => ''
    }),
    getWorkspaceFolder: () => ({ uri: { fsPath: '/repo' } })
  }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { ImagePanelProvider } = require('../views/imagePanelProvider');
Module._load = originalLoad;

async function testLoadsD1StagedAssets() {
  const sent = [];
  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: {
      listStagedAssets: async () => ({
        assets: [
          {
            id: 'asset-1',
            slug: 'river-map',
            display_name: 'River Map',
            image_src: 'https://example.com/river.png',
            source_url: 'https://source.example.com/river',
            photographer: 'Owen Corpening',
            license: 'OAT',
            status: 'staged'
          }
        ]
      })
    }
  });
  provider._view = { webview: { postMessage: message => sent.push(message) } };

  await provider._loadStaged();

  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].type, 'staged');
  assert.strictEqual(sent[0].source, 'd1');
  assert.strictEqual(sent[0].images.length, 1);
  assert.strictEqual(sent[0].images[0].source, 'd1');
  assert.strictEqual(sent[0].images[0].name, 'river-map');
  assert.strictEqual(sent[0].images[0].displayName, 'River Map');
  assert.strictEqual(sent[0].images[0].thumbUrl, 'https://example.com/river.png');
}

async function testD1ActionsAreGuarded() {
  infoMessages.length = 0;
  warningMessages.length = 0;
  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: {
      savePlacement: async () => {
        throw new Error('should not save');
      },
      listStagedAssets: async () => ({ assets: [] })
    }
  });

  await provider._handlePlace({ source: 'd1' });
  await provider._handleDiscard({ source: 'd1' });

  assert.strictEqual(warningMessages.length, 1);
  assert.match(warningMessages[0], /Open the target markdown draft/);
  assert.strictEqual(infoMessages.length, 1);
  assert.match(infoMessages[0], /D1 discard is not wired/);
}

async function testD1PlaceCreatesPlannedPlacement() {
  infoMessages.length = 0;
  warningMessages.length = 0;
  quickPickValues.length = 0;
  inputBoxValues.length = 0;
  quickPickValues.push('substack');
  inputBoxValues.push('3');

  const calls = [];
  const sent = [];
  fakeVscode.window.activeTextEditor = fakeEditor();

  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: {
      savePlacement: async payload => {
        calls.push(payload);
        return { placement: payload.placement, saga: payload.saga };
      },
      listStagedAssets: async () => ({ assets: [] })
    }
  });
  provider._view = { webview: { postMessage: message => sent.push(message) } };

  const result = await provider._handlePlace({
    source: 'd1',
    id: 'asset-1',
    name: 'river-map',
    displayName: 'River Map'
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].contentDraft.draftPath, 'drafts/part-09.md');
  assert.strictEqual(calls[0].placement.assetId, 'asset-1');
  assert.strictEqual(calls[0].placement.contentDraftId, calls[0].contentDraft.id);
  assert.strictEqual(calls[0].placement.target, 'substack');
  assert.strictEqual(calls[0].placement.figureNumber, '3');
  assert.strictEqual(calls[0].placement.snippetFormat, 'html-figure');
  assert.strictEqual(calls[0].placement.status, 'planned');
  assert.strictEqual(calls[0].saga.assetId, 'asset-1');
  assert.strictEqual(calls[0].saga.assetPlacementId, calls[0].placement.id);
  assert.strictEqual(calls[0].saga.status, 'running');
  assert.strictEqual(result.placement.id, calls[0].placement.id);
  assert.strictEqual(sent.at(-1).type, 'staged');
  assert.match(infoMessages.at(-1), /Planned substack placement/);

  fakeVscode.window.activeTextEditor = null;
}

function fakeEditor() {
  const lines = [
    '# Water Part IX',
    '',
    'Some intro.',
    '',
    '## Maps',
    'Dense paragraph.'
  ];
  const document = {
    uri: { fsPath: '/repo/drafts/part-09.md' },
    lineCount: lines.length,
    lineAt: index => ({ text: lines[index] || '' }),
    getText: selection => selection ? 'Dense paragraph.' : '<figcaption>Figure 2: Existing</figcaption>'
  };
  const position = { line: 5 };
  return {
    document,
    selection: {
      active: position,
      start: position,
      end: position
    }
  };
}

async function run() {
  await testLoadsD1StagedAssets();
  await testD1ActionsAreGuarded();
  await testD1PlaceCreatesPlannedPlacement();
  console.log('imagePanelProvider tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
