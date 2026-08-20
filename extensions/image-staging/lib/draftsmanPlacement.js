'use strict';

const { placeAsset } = require('./imagePipeline');
const { extractSeriesAndPartDir, placementId, sagaId } = require('../views/imagePanelProvider');
const { buildContentDraftRecord } = require('./reviewImageNeedCommand');

// Shared placement glue used by both Sweep and Review — the concrete
// answer to "Review must reuse Engine 1/2, not build a fourth mechanism."
// Reuses the same placement-object-building logic the existing panel/
// planned-placement flows use (via Step 0's widened imagePanelProvider.js
// exports + reviewImageNeedCommand.js's buildContentDraftRecord), rather
// than duplicating ~150 lines of it.

function buildDraftsmanPlacement({ vscode, editor, asset } = {}) {
  const contentDraft = buildContentDraftRecord({ vscode, editor });
  const { series, partDir } = extractSeriesAndPartDir(editor);
  const target = 'other'; // legal per the D1 CHECK constraint; snippetFormat below is explicit anyway
  const id = placementId({ assetId: asset.id, contentDraftId: contentDraft.id, target, figureNumber: '' });

  const placement = {
    id,
    assetId: asset.id,
    contentDraftId: contentDraft.id,
    target,
    snippetFormat: 'markdown-image',
    series,
    partDir,
    status: 'planned'
  };

  return { contentDraft, placement, saga: { id: sagaId(id) } };
}

// A sibling of writeSnippetToActiveEditor (which replaces "the current
// selection") — Sweep/Review must target a specific, already-known line
// number instead, since by the time placeAsset() calls this back the
// author's cursor may have moved (Sweep processes multiple placeholders
// in one document without re-selecting each one).
function resolvePlaceholderLine({ vscode, editor, lineNumber }) {
  return async ({ snippet }) => {
    const line = editor.document.lineAt(lineNumber);
    const ok = await editor.edit(editBuilder => {
      editBuilder.replace(line.range, snippet);
    });
    if (!ok) throw new Error('Draftsman: VS Code rejected the placement edit.');
    if (editor.document.save) await editor.document.save();
  };
}

// Thin pass-through to placeAsset() — exists only so tests can inject a
// fake without touching imagePipeline.js itself.
async function runPlacement(options, place = placeAsset) {
  return place(options);
}

module.exports = { buildDraftsmanPlacement, resolvePlaceholderLine, runPlacement };
