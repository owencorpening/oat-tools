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
    showWarningMessage: async (message, options, ...choices) => {
      warningMessages.push(message);
      return choices.includes('Discard') ? 'Discard' : message;
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
  await provider._handleDiscard({ source: 'd1', id: 'asset-1' });

  assert.strictEqual(warningMessages.length, 2);
  assert.match(warningMessages[0], /Open the target markdown draft/);
  assert.match(warningMessages[1], /Set oatImages\.ledgerApiUrl/);
  assert.strictEqual(infoMessages.length, 0);
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

async function testD1DiscardMarksAssetDiscarded() {
  infoMessages.length = 0;
  warningMessages.length = 0;

  const calls = [];
  const sent = [];
  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: {
      discardAsset: async assetId => calls.push(assetId),
      listStagedAssets: async () => ({ assets: [] })
    }
  });
  provider._view = { webview: { postMessage: message => sent.push(message) } };

  const result = await provider._handleDiscard({
    source: 'd1',
    id: 'asset-1',
    displayName: 'River Map'
  });

  assert.deepStrictEqual(calls, ['asset-1']);
  assert.deepStrictEqual(result, { assetId: 'asset-1' });
  assert.match(infoMessages.at(-1), /Image discarded/);
  assert.strictEqual(sent.at(-1).type, 'staged');
}

async function testProviderSearchSendsResults() {
  const sent = [];
  const calls = [];
  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: {
      searchImageProviders: async payload => {
        calls.push(payload);
        return {
          results: [
            {
              provider: 'pexels',
              providerId: '1234',
              title: 'Wetland',
              sourceUrl: 'https://www.pexels.com/photo/wetland-1234/',
              imageSrc: 'https://images.pexels.com/photos/1234/large.jpeg',
              photographer: 'Pexels Photographer',
              license: 'Pexels License'
            }
          ]
        };
      }
    }
  });
  provider._view = { webview: { postMessage: message => sent.push(message) } };

  const result = await provider._handleProviderSearch({ query: ' wetland ', providers: ['pexels'] });

  assert.deepStrictEqual(calls, [{ query: 'wetland', providers: ['pexels'], perPage: 12 }]);
  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(sent.at(-1).type, 'providerResults');
  assert.strictEqual(sent.at(-1).results[0].providerId, '1234');
}

async function testStageProviderImageCreatesAssetAndRefreshes() {
  infoMessages.length = 0;

  const calls = [];
  const sent = [];
  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: {
      stageProviderImage: async payload => {
        calls.push(payload);
        return { asset: { id: 'asset-1' } };
      },
      listStagedAssets: async () => ({
        assets: [
          {
            id: 'asset-1',
            slug: 'wetland',
            display_name: 'Wetland',
            source_url: 'https://www.pexels.com/photo/wetland-1234/',
            status: 'staged'
          }
        ]
      })
    }
  });
  provider._view = { webview: { postMessage: message => sent.push(message) } };

  const response = await provider._handleStageProviderImage({
    provider: 'pexels',
    providerId: '1234',
    title: 'Wetland',
    sourceUrl: 'https://www.pexels.com/photo/wetland-1234/'
  });

  assert.strictEqual(response.asset.id, 'asset-1');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].provider, 'pexels');
  assert.strictEqual(calls[0].providerId, '1234');
  assert.strictEqual(calls[0].result.title, 'Wetland');
  assert.strictEqual(sent.some(message => message.type === 'providerStaged'), true);
  assert.strictEqual(sent.at(-1).type, 'staged');
  assert.match(infoMessages.at(-1), /Staged Wetland/);
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
  await testD1DiscardMarksAssetDiscarded();
  await testProviderSearchSendsResults();
  await testStageProviderImageCreatesAssetAndRefreshes();
  console.log('imagePanelProvider tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
