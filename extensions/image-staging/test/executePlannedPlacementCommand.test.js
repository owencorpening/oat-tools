'use strict';

const assert = require('assert');
const {
  executePlannedPlacementRun,
  hasPlacementLedgerMethods
} = require('../lib/executePlannedPlacementCommand');

async function testExecuteRunsPlacementAndReplacesSnippet() {
  const messages = [];
  const document = new FakeDocument('Intro\nOLD_SNIPPET\nOutro');
  const editor = new FakeEditor(document);
  const vscode = fakeVscode({ messages, editor });
  const ledgerWriter = fakeLedgerWriter({
    placements: [
      {
        placement_id: 'placement-1',
        placement_asset_id: 'asset-1',
        target: 'substack',
        figure_number: '3',
        asset_id: 'asset-1',
        slug: 'river-map',
        display_name: 'River Map',
        source_url: 'https://example.com/river.jpg',
        intake_section: 'water-series/part-09',
        saga_id: 'saga-1',
        snippet: 'OLD_SNIPPET'
      }
    ]
  });
  const calls = [];

  const result = await executePlannedPlacementRun({
    vscode,
    ledgerWriter,
    existsSync: () => true,
    runPlacement: async payload => {
      calls.push(['runPlacement', payload.sagaId, payload.repoPath]);
      await payload.writeSnippet({
        snippet: 'NEW_SNIPPET',
        snippetFormat: 'html-figure',
        placement: payload.placement
      });
      return { ok: true };
    }
  });

  assert.deepStrictEqual(result, { ok: true });
  assert.deepStrictEqual(calls, [['runPlacement', 'saga-1', '/repo/images']]);
  assert.strictEqual(document.text, 'Intro\nNEW_SNIPPET\nOutro');
  assert.strictEqual(document.saved, true);
  assert.deepStrictEqual(messages.at(-1), ['info', 'OAT: Image placement completed.']);
}

async function testCancelStopsBeforeSideEffects() {
  const messages = [];
  const vscode = fakeVscode({
    messages,
    warningResult: undefined,
    editor: new FakeEditor(new FakeDocument('Draft'))
  });
  let ran = false;

  const result = await executePlannedPlacementRun({
    vscode,
    ledgerWriter: fakeLedgerWriter({
      placements: [
        {
          placement_id: 'placement-1',
          target: 'substack',
          asset_id: 'asset-1',
          slug: 'river-map',
          saga_id: 'saga-1'
        }
      ]
    }),
    existsSync: () => true,
    runPlacement: async () => {
      ran = true;
    }
  });

  assert.strictEqual(result.sagaId, 'saga-1');
  assert.strictEqual(ran, false);
}

async function testMissingLedgerWarning() {
  const messages = [];
  const result = await executePlannedPlacementRun({ vscode: fakeVscode({ messages }) });

  assert.strictEqual(result, null);
  assert.deepStrictEqual(messages[0], ['warning', 'OAT: Set oatImages.ledgerApiUrl to execute image placement runs.']);
}

function testLedgerMethodCheck() {
  assert.strictEqual(hasPlacementLedgerMethods(fakeLedgerWriter({ placements: [] })), true);
  assert.strictEqual(hasPlacementLedgerMethods({ listPlannedPlacements: async () => ({ placements: [] }) }), false);
}

function fakeLedgerWriter({ placements }) {
  return {
    listPlannedPlacements: async () => ({ placements }),
    markSagaStep: async () => {},
    markAssetPublishing: async () => {},
    markPlacementPublishing: async () => {},
    updateAssetPublication: async () => {},
    updatePlacementSnippet: async () => {},
    markPlaced: async () => {},
    markFailed: async () => {}
  };
}

function fakeVscode(options = {}) {
  const messages = options.messages || [];
  return {
    Position: FakePosition,
    Range: FakeRange,
    window: {
      activeTextEditor: options.editor || null,
      showQuickPick: async items => items[0],
      showWarningMessage: async message => {
        messages.push(['warning', message]);
        return Object.prototype.hasOwnProperty.call(options, 'warningResult')
          ? options.warningResult
          : 'Place Image';
      },
      showInformationMessage: message => messages.push(['info', message])
    },
    workspace: {
      getConfiguration: () => ({
        get: (key, defaultValue) => {
          if (key === 'imagesRepoPath') return '/repo/images';
          return defaultValue;
        }
      })
    }
  };
}

class FakeEditor {
  constructor(document) {
    this.document = document;
    this.selection = {
      isEmpty: true,
      active: document.positionAt(document.text.length)
    };
  }

  async edit(callback) {
    callback({
      replace: (range, text) => this.document.replace(range, text),
      insert: (position, text) => this.document.insert(position, text)
    });
    return true;
  }
}

class FakeDocument {
  constructor(text) {
    this.text = text;
    this.saved = false;
    this.uri = { fsPath: '/draft.md' };
  }

  getText() {
    return this.text;
  }

  positionAt(offset) {
    const before = this.text.slice(0, offset);
    const lines = before.split('\n');
    return new FakePosition(lines.length - 1, lines.at(-1).length, offset);
  }

  lineAt(line) {
    const lines = this.text.split('\n');
    const start = lines.slice(0, line).join('\n').length + (line > 0 ? 1 : 0);
    const end = start + lines[line].length;
    return { range: { end: this.positionAt(end) } };
  }

  replace(range, text) {
    this.text = this.text.slice(0, range.start.offset) + text + this.text.slice(range.end.offset);
  }

  insert(position, text) {
    this.text = this.text.slice(0, position.offset) + text + this.text.slice(position.offset);
  }

  async save() {
    this.saved = true;
  }
}

class FakePosition {
  constructor(line, character, offset) {
    this.line = line;
    this.character = character;
    this.offset = offset;
  }
}

class FakeRange {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

(async () => {
  await testExecuteRunsPlacementAndReplacesSnippet();
  await testCancelStopsBeforeSideEffects();
  await testMissingLedgerWarning();
  testLedgerMethodCheck();
  console.log('executePlannedPlacementCommand tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
