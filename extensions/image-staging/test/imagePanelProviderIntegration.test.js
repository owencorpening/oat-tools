'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const os = require('os');

/**
 * imagePanelProviderIntegration.test.js
 *
 * Regression test for the full image placement workflow.
 * Tests the happy path: open markdown file → stage image → place figure.
 *
 * This test demonstrates the pattern for integration testing across OAT extensions.
 * It:
 * - Creates a fixture repo with valid markdown structure
 * - Stages a test image to ~/Downloads
 * - Simulates the VSCode editor and placement workflow
 * - Verifies all placement metadata is correctly saved
 * - Cleans up all external state (Downloads folder)
 */

// Test fixtures
const fixturesDir = path.join(__dirname, 'fixtures', 'test-repo');
const testMarkdownPath = path.join(fixturesDir, 'substack-ideas', 'test-series', 'test-draft.md');
const testImagePath = path.join(os.homedir(), 'Downloads', 'integration-test-image.png');

// Ensure fixtures exist
if (!fs.existsSync(testMarkdownPath)) {
  throw new Error(`Test fixture not found: ${testMarkdownPath}`);
}

// Create test PNG (minimal valid PNG)
function createTestPng(outputPath) {
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08, 0x02, 0x00, 0x00, 0x00, // bit depth 8, RGB
    0x90, 0x77, 0x53, 0xDE, // CRC
    0x00, 0x00, 0x00, 0x0C, // IDAT chunk length
    0x49, 0x44, 0x41, 0x54, // IDAT
    0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00,
    0x18, 0xDD, 0x8D, 0xB4, // CRC
    0x00, 0x00, 0x00, 0x00, // IEND chunk length
    0x49, 0x45, 0x4E, 0x44, // IEND
    0xAE, 0x42, 0x60, 0x82  // CRC
  ]);
  fs.writeFileSync(outputPath, png);
}

// Mock VSCode
const infoMessages = [];
const warningMessages = [];
const fakeVscode = {
  window: {
    activeTextEditor: null,
    showInformationMessage: async (message) => {
      infoMessages.push(message);
      return message;
    },
    showWarningMessage: async (message, options, ...choices) => {
      warningMessages.push(message);
      return choices.includes('Discard') ? 'Discard' : message;
    }
  },
  workspace: {
    getConfiguration: () => ({
      get: () => ''
    }),
    getWorkspaceFolder: () => ({ uri: { fsPath: fixturesDir } })
  },
  Uri: {
    file: (p) => ({ fsPath: p })
  }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { ImagePanelProvider } = require('../views/imagePanelProvider');
Module._load = originalLoad;

// Create fake editor
function createFakeEditor(fsPath) {
  const markdownContent = fs.readFileSync(fsPath, 'utf-8');
  const lines = markdownContent.split('\n');

  const document = {
    uri: { fsPath },
    lineCount: lines.length,
    text: markdownContent,
    saved: false,
    lineAt: (index) => ({ text: lines[index] || '' }),
    getText: (selection) => markdownContent,
    save: async function() {
      this.saved = true;
    }
  };

  const position = { line: lines.length - 1 };

  return {
    document,
    selection: {
      active: position,
      start: position,
      end: position,
      isEmpty: true
    },
    edit: async function(callback) {
      callback({
        insert: (pos, text) => {
          document.text += '\n' + text;
        },
        replace: (range, text) => {
          document.text = text;
        }
      });
      return true;
    }
  };
}

// Create mock ledger with all required methods
function createMockLedger(overrides = {}) {
  return {
    savePlacement: async () => {},
    listStagedAssets: async () => ({ assets: [] }),
    listPlannedPlacements: async () => ({ placements: [] }),
    markSagaStep: async () => {},
    markAssetPublishing: async () => {},
    markPlacementPublishing: async () => {},
    updateAssetPublication: async () => {},
    updatePlacementSnippet: async () => {},
    markPlaced: async () => {},
    markFailed: async () => {},
    ...overrides
  };
}

async function testPlacementHappyPath() {
  infoMessages.length = 0;
  warningMessages.length = 0;

  // Stage test image
  createTestPng(testImagePath);
  assert(fs.existsSync(testImagePath), 'Test image should exist in Downloads');

  try {
    const savedPlacements = [];
    const placementRuns = [];

    // Set up editor pointing to test markdown
    fakeVscode.window.activeTextEditor = createFakeEditor(testMarkdownPath);

    const provider = new ImagePanelProvider({ subscriptions: [] }, {
      ledgerWriter: createMockLedger({
        savePlacement: async (payload) => {
          savedPlacements.push(payload);
          return { placement: payload.placement, saga: payload.saga };
        },
        listPlannedPlacements: async () => ({ placements: [] })
      }),
      getImagesRepoPath: () => path.join(fixturesDir, 'images'),
      runPlacement: async (payload) => {
        placementRuns.push(payload);
        await payload.writeSnippet({
          snippet: '<figure><img src="test.png" alt="Test" /><figcaption>Test figure</figcaption></figure>',
          snippetFormat: 'html-figure',
          placement: payload.placement
        });
        return { ok: true };
      }
    });

    provider._view = { webview: { postMessage: () => {} } };

    // Test image asset
    const testAsset = {
      source: 'd1',
      id: 'integration-test-asset-1',
      slug: 'integration-test-image',
      name: 'integration-test-image',
      displayName: 'Integration Test Image',
      photographer: 'Owen Corpening',
      license: 'OAT',
      attribution: 'Integration test image',
      status: 'staged'
    };

    // Execute placement
    const result = await provider._handlePlace(testAsset);

    // Verify results
    assert.strictEqual(warningMessages.length, 0, 'Should have no warnings');
    assert.strictEqual(savedPlacements.length, 1, 'Should save 1 placement');
    assert.strictEqual(placementRuns.length, 1, 'Should run placement once');

    const placement = savedPlacements[0];
    assert.strictEqual(placement.placement.assetId, 'integration-test-asset-1', 'Asset ID matches');
    assert.strictEqual(placement.placement.target, 'substack', 'Target is substack');
    assert.strictEqual(placement.placement.figureNumber, '1', 'Figure number is 1');
    assert.match(placement.contentDraft.draftPath, /test-draft\.md/, 'Draft path matches');
    assert(placement.saga.id, 'Saga has ID');
    assert.strictEqual(placement.saga.status, 'running', 'Saga status is running');

    const editorText = fakeVscode.window.activeTextEditor.document.text;
    assert(editorText.includes('<figure>'), 'Editor contains figure element');
    assert(result.placed.ok, 'Placement succeeded');

    assert.match(infoMessages[infoMessages.length - 1], /Placed Figure 1/, 'Success message shown');

  } finally {
    // Cleanup: remove test image from Downloads
    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
    fakeVscode.window.activeTextEditor = null;
  }
}

async function run() {
  await testPlacementHappyPath();
  console.log('imagePanelProviderIntegration tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
