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

const { ImagePanelProvider, placementTargetFromDraftPath } = require('../views/imagePanelProvider');
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
            source_name: 'field-notes/river-map.png',
            photographer: 'Owen Corpening',
            license: 'OAT',
            attribution: 'Image: River Map, by Owen Corpening.',
            status: 'staged'
          }
        ]
      })
    }
  });
  provider._view = { webview: { postMessage: message => sent.push(message) } };

  await provider._loadStaged();

  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[0].type, 'providers');
  assert.deepStrictEqual(sent[0].providers, [{ id: 'downloads', label: 'Downloads' }]);
  assert.strictEqual(sent[1].type, 'staged');
  assert.strictEqual(sent[1].source, 'd1');
  assert.strictEqual(sent[1].images.length, 1);
  assert.strictEqual(sent[1].images[0].source, 'd1');
  assert.strictEqual(sent[1].images[0].slug, 'river-map');
  assert.strictEqual(sent[1].images[0].name, 'river-map');
  assert.strictEqual(sent[1].images[0].displayName, 'River Map');
  assert.strictEqual(sent[1].images[0].thumbUrl, 'https://example.com/river.png');
  assert.deepStrictEqual(sent[1].images[0].provenance, [
    { label: 'Source', value: 'Web', tone: undefined },
    { label: 'Origin', value: 'source.example.com', tone: undefined },
    { label: 'Creator', value: 'Owen Corpening' },
    { label: 'Attribution', value: 'Image: River Map, by Owen Corpening.' },
    { label: 'License', value: 'OAT', tone: undefined },
    { label: 'Status', value: 'staged', tone: undefined }
  ]);
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

async function testD1PlacePlacesFigureDirectly() {
  infoMessages.length = 0;
  warningMessages.length = 0;
  quickPickValues.length = 0;
  inputBoxValues.length = 0;

  const saved = [];
  const runCalls = [];
  const sent = [];
  fakeVscode.window.activeTextEditor = fakeEditor();

  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: directPlacementLedger({
      savePlacement: async payload => {
        saved.push(payload);
        return { placement: payload.placement, saga: payload.saga };
      },
      listStagedAssets: async () => ({ assets: [] })
    }),
    getImagesRepoPath: () => '/repo/images',
    runPlacement: async payload => {
      runCalls.push(payload);
      await payload.writeSnippet({
        snippet: '<figure>Generated figure</figure>',
        snippetFormat: 'html-figure',
        placement: payload.placement
      });
      return { ok: true };
    }
  });
  provider._view = { webview: { postMessage: message => sent.push(message) } };

  const result = await provider._handlePlace({
    source: 'd1',
    id: 'asset-1',
    slug: 'river-map',
    name: 'river-map',
    displayName: 'River Map',
    attribution: 'Image: River Map, by Owen Corpening.'
  });

  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].contentDraft.draftPath, 'substack-ideas/part-09.md');
  assert.strictEqual(saved[0].placement.assetId, 'asset-1');
  assert.strictEqual(saved[0].placement.contentDraftId, saved[0].contentDraft.id);
  assert.strictEqual(saved[0].placement.target, 'substack');
  assert.strictEqual(saved[0].placement.figureNumber, '3');
  assert.strictEqual(saved[0].placement.draftLocation.caption, 'River Map. Image: River Map, by Owen Corpening.');
  assert.strictEqual(saved[0].placement.snippetFormat, 'html-figure');
  assert.strictEqual(saved[0].placement.status, 'planned');
  assert.strictEqual(saved[0].saga.assetId, 'asset-1');
  assert.strictEqual(saved[0].saga.assetPlacementId, saved[0].placement.id);
  assert.strictEqual(saved[0].saga.status, 'running');
  assert.strictEqual(runCalls.length, 1);
  assert.strictEqual(runCalls[0].sagaId, saved[0].saga.id);
  assert.strictEqual(runCalls[0].repoPath, '/repo/images');
  assert.strictEqual(runCalls[0].asset.slug, 'river-map');
  assert.strictEqual(fakeVscode.window.activeTextEditor.document.text.includes('<figure>Generated figure</figure>'), true);
  assert.strictEqual(fakeVscode.window.activeTextEditor.document.saved, true);
  assert.strictEqual(result.placement.id, saved[0].placement.id);
  assert.deepStrictEqual(result.placed, { ok: true });
  assert.strictEqual(sent.at(-1).type, 'staged');
  assert.match(infoMessages.at(-1), /Placed Figure 3/);

  fakeVscode.window.activeTextEditor = null;
}

async function testD1PlaceInfersSubstackTargetFromFolder() {
  infoMessages.length = 0;
  warningMessages.length = 0;
  quickPickValues.length = 0;
  inputBoxValues.length = 0;

  const calls = [];
  const sent = [];
  fakeVscode.window.activeTextEditor = fakeEditor('/repo/substack-ideas/part-10.md');

  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: directPlacementLedger({
      savePlacement: async payload => {
        calls.push(payload);
        return { placement: payload.placement, saga: payload.saga };
      },
      listPlannedPlacements: async () => ({
        placements: [{ figure_number: '4' }]
      }),
      listStagedAssets: async () => ({ assets: [] })
    }),
    runPlacement: async () => ({ ok: true })
  });
  provider._view = { webview: { postMessage: message => sent.push(message) } };

  await provider._handlePlace({
    source: 'd1',
    id: 'asset-1',
    slug: 'river-map',
    name: 'river-map',
    displayName: 'River Map',
    photographer: 'Owen Corpening',
    license: 'OAT'
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].contentDraft.draftPath, 'substack-ideas/part-10.md');
  assert.strictEqual(calls[0].placement.target, 'substack');
  assert.strictEqual(calls[0].placement.figureNumber, '5');
  assert.strictEqual(calls[0].placement.draftLocation.caption, 'River Map. image by Owen Corpening, OAT.');
  assert.strictEqual(calls[0].placement.snippetFormat, 'html-figure');
  assert.strictEqual(sent.at(-1).type, 'staged');

  fakeVscode.window.activeTextEditor = null;
}

async function testD1PlaceInfersCarouselTargetFromFilename() {
  infoMessages.length = 0;
  warningMessages.length = 0;
  quickPickValues.length = 0;
  inputBoxValues.length = 0;

  const calls = [];
  fakeVscode.window.activeTextEditor = fakeEditor('/repo/drafts/part-09-carousel.md');

  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: directPlacementLedger({
      savePlacement: async payload => {
        calls.push(payload);
        return { placement: payload.placement, saga: payload.saga };
      },
      listStagedAssets: async () => ({ assets: [] })
    }),
    runPlacement: async () => ({ ok: true })
  });
  provider._view = { webview: { postMessage: () => {} } };

  await provider._handlePlace({
    source: 'd1',
    id: 'asset-1',
    slug: 'river-map',
    name: 'river-map',
    displayName: 'River Map'
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].placement.target, 'carousel');
  assert.strictEqual(calls[0].placement.figureNumber, '3');
  assert.strictEqual(calls[0].placement.draftLocation.caption, 'River Map.');
  assert.strictEqual(calls[0].placement.snippetFormat, 'marp-image');

  fakeVscode.window.activeTextEditor = null;
}

async function testD1PlaceStartsFigureNumbersAtOne() {
  inputBoxValues.length = 0;

  const calls = [];
  fakeVscode.window.activeTextEditor = fakeEditor('/repo/substack-ideas/part-01.md', {
    fullText: 'No figures yet.'
  });

  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: directPlacementLedger({
      savePlacement: async payload => {
        calls.push(payload);
        return { placement: payload.placement, saga: payload.saga };
      },
      listPlannedPlacements: async () => ({ placements: [] }),
      listStagedAssets: async () => ({ assets: [] })
    }),
    runPlacement: async () => ({ ok: true })
  });
  provider._view = { webview: { postMessage: () => {} } };

  await provider._handlePlace({
    source: 'd1',
    id: 'asset-1',
    slug: 'first-figure',
    displayName: 'First Figure',
    photographer: 'Owen Corpening',
    license: 'OAT'
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].placement.figureNumber, '1');
  assert.strictEqual(calls[0].placement.draftLocation.caption, 'First Figure. image by Owen Corpening, OAT.');

  fakeVscode.window.activeTextEditor = null;
}

async function testD1PlaceWarnsWhenTargetCannotBeInferred() {
  warningMessages.length = 0;
  inputBoxValues.length = 0;
  fakeVscode.window.activeTextEditor = fakeEditor('/repo/drafts/part-09.md');

  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: {
      savePlacement: async () => {
        throw new Error('should not save');
      }
    }
  });

  const result = await provider._handlePlace({
    source: 'd1',
    id: 'asset-1',
    displayName: 'River Map'
  });

  assert.strictEqual(result, null);
  assert.match(warningMessages.at(-1), /substack-ideas|carousel\.md/);

  fakeVscode.window.activeTextEditor = null;
}

function testPlacementTargetFromDraftPath() {
  assert.strictEqual(placementTargetFromDraftPath('/repo/substack-ideas/draft.md'), 'substack');
  assert.strictEqual(placementTargetFromDraftPath('/repo/decks/part-carousel.md'), 'carousel');
  assert.strictEqual(placementTargetFromDraftPath('/repo/drafts/part-09.md'), null);
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
    },
    localDownloadsProvider: {
      searchDownloads: async payload => {
        calls.push({ local: payload });
        return {
          results: [
            {
              provider: 'downloads',
              providerId: '/home/owen/Downloads/wetland.png',
              title: 'Wetland local',
              sourcePath: '/home/owen/Downloads/wetland.png',
              sourceName: 'wetland.png',
              status: 'needs-provenance',
              provenanceConfidence: 'filename-hint'
            }
          ]
        };
      }
    }
  });
  provider._view = { webview: { postMessage: message => sent.push(message) } };

  const result = await provider._handleProviderSearch({ query: ' wetland ', providers: ['downloads', 'pexels'] });

  assert.deepStrictEqual(calls, [
    { local: { query: 'wetland', limit: 12 } },
    { query: 'wetland', providers: ['pexels'], perPage: 12 }
  ]);
  assert.strictEqual(result.results.length, 2);
  assert.strictEqual(sent.at(-1).type, 'providerResults');
  assert.strictEqual(sent.at(-1).results[0].provider, 'downloads');
  assert.deepStrictEqual(sent.at(-1).results[0].provenance, [
    { label: 'Source', value: 'Downloads', tone: undefined },
    { label: 'Origin', value: 'wetland.png', tone: undefined },
    { label: 'Rights', value: 'unknown', tone: 'warning' },
    { label: 'Status', value: 'needs provenance', tone: 'warning' },
    { label: 'Hint', value: 'filename hint' }
  ]);
  assert.strictEqual(sent.at(-1).results[1].providerId, '1234');
  assert.deepStrictEqual(sent.at(-1).results[1].provenance, [
    { label: 'Source', value: 'Pexels', tone: undefined },
    { label: 'Origin', value: 'pexels.com', tone: undefined },
    { label: 'Creator', value: 'Pexels Photographer' },
    { label: 'License', value: 'Pexels License', tone: undefined }
  ]);
}

async function testProviderSearchUsesDownloadsWithoutLedger() {
  const sent = [];
  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    localDownloadsProvider: {
      searchDownloads: async () => ({
        results: [
          {
            provider: 'downloads',
            providerId: '/home/owen/Downloads/wetland.png',
            title: 'Wetland local',
            sourcePath: '/home/owen/Downloads/wetland.png'
          }
        ]
      })
    }
  });
  provider._view = { webview: { postMessage: message => sent.push(message) } };

  const result = await provider._handleProviderSearch({ query: 'wetland', providers: ['downloads', 'pexels'] });

  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(result.results[0].provider, 'downloads');
  assert.strictEqual(sent.at(-1).type, 'providerResults');
  assert.strictEqual(sent.at(-1).results[0].title, 'Wetland local');
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

async function testStageDownloadsProviderImageSavesAssetAndRefreshes() {
  infoMessages.length = 0;

  const calls = [];
  const sent = [];
  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: {
      saveAsset: async payload => calls.push(payload),
      listStagedAssets: async () => ({ assets: [] })
    },
    localDownloadsProvider: {
      stageDownloadsResult: async result => ({
        id: 'asset-downloads',
        assetType: 'image',
        slug: 'wetland-local',
        displayName: result.title,
        sourcePath: result.sourcePath,
        sourceName: result.sourceName,
        status: 'needs-provenance'
      })
    }
  });
  provider._view = { webview: { postMessage: message => sent.push(message) } };

  const response = await provider._handleStageProviderImage({
    provider: 'downloads',
    providerId: '/home/owen/Downloads/wetland.png',
    title: 'Wetland local',
    sourcePath: '/home/owen/Downloads/wetland.png',
    sourceName: 'wetland.png'
  });

  assert.strictEqual(response.asset.id, 'asset-downloads');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].asset.sourcePath, '/home/owen/Downloads/wetland.png');
  assert.strictEqual(sent.some(message => message.type === 'providerStaged'), true);
  assert.strictEqual(sent.at(-1).type, 'staged');
  assert.match(infoMessages.at(-1), /Staged Wetland local/);
}

function testWebviewHtmlIncludesActionButtonsAndClickRouting() {
  const provider = new ImagePanelProvider({ subscriptions: [] }, {});
  const html = provider._html({ cspSource: 'vscode-resource:' });

  assert.match(html, /data-action="stage"/);
  assert.match(html, /data-action="place"/);
  assert.match(html, /data-action="discard"/);
  assert.match(html, /Place Figure/);
  assert.match(html, /handleCardAction/);
  assert.match(html, /type: 'stageProviderImage'/);
  assert.match(html, /type: 'place'/);
  assert.match(html, /type: 'discard'/);
}

function directPlacementLedger(overrides = {}) {
  return {
    savePlacement: async () => {},
    markSagaStep: async () => {},
    markAssetPublishing: async () => {},
    markPlacementPublishing: async () => {},
    updateAssetPublication: async () => {},
    updatePlacementSnippet: async () => {},
    markPlaced: async () => {},
    markFailed: async () => {},
    listStagedAssets: async () => ({ assets: [] }),
    ...overrides
  };
}

function fakeEditor(fsPath = '/repo/substack-ideas/part-09.md', options = {}) {
  const lines = [
    '# Water Part IX',
    '',
    'Some intro.',
    '',
    '## Maps',
    'Dense paragraph.'
  ];
  const document = {
    uri: { fsPath },
    lineCount: lines.length,
    text: options.fullText || '<figcaption>Figure 2: Existing</figcaption>',
    saved: false,
    lineAt: index => ({ text: lines[index] || '' }),
    getText(selection) {
      return selection ? 'Dense paragraph.' : this.text;
    },
    async save() {
      this.saved = true;
    }
  };
  const position = { line: 5 };
  return {
    document,
    selection: {
      active: position,
      start: position,
      end: position,
      isEmpty: true
    },
    async edit(callback) {
      callback({
        insert: (pos, text) => {
          document.text += text;
        },
        replace: (range, text) => {
          document.text = text;
        }
      });
      return true;
    }
  };
}

async function run() {
  await testLoadsD1StagedAssets();
  await testD1ActionsAreGuarded();
  await testD1PlacePlacesFigureDirectly();
  await testD1PlaceInfersSubstackTargetFromFolder();
  await testD1PlaceInfersCarouselTargetFromFilename();
  await testD1PlaceStartsFigureNumbersAtOne();
  await testD1PlaceWarnsWhenTargetCannotBeInferred();
  await testD1DiscardMarksAssetDiscarded();
  await testProviderSearchSendsResults();
  await testProviderSearchUsesDownloadsWithoutLedger();
  await testStageProviderImageCreatesAssetAndRefreshes();
  await testStageDownloadsProviderImageSavesAssetAndRefreshes();
  testPlacementTargetFromDraftPath();
  testWebviewHtmlIncludesActionButtonsAndClickRouting();
  console.log('imagePanelProvider tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
