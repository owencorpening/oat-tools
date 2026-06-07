'use strict';

const assert = require('assert');
const Module = require('module');

const infoMessages = [];
const fakeVscode = {
  window: {
    showInformationMessage: async message => {
      infoMessages.push(message);
      return message;
    }
  },
  workspace: {
    getConfiguration: () => ({
      get: () => ''
    })
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
  const provider = new ImagePanelProvider({ subscriptions: [] }, {
    ledgerWriter: { listStagedAssets: async () => ({ assets: [] }) }
  });

  await provider._handlePlace({ source: 'd1' });
  await provider._handleDiscard({ source: 'd1' });

  assert.strictEqual(infoMessages.length, 2);
  assert.match(infoMessages[0], /placement saga UI/);
  assert.match(infoMessages[1], /D1 discard is not wired/);
}

async function run() {
  await testLoadsD1StagedAssets();
  await testD1ActionsAreGuarded();
  console.log('imagePanelProvider tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
