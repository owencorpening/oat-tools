'use strict';

function findFigures(lines) {
  const figures = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '<figure>') {
      let captionLineIdx = -1;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        if (lines[j].includes('<figcaption>')) {
          captionLineIdx = j;
          break;
        }
      }
      if (captionLineIdx !== -1) {
        figures.push({ startIdx: i, captionLineIdx });
      }
    }
  }
  return figures;
}

function extractSheetUrl(captionText) {
  const match = captionText.match(/href="([^"]+)"/);
  return match ? match[1] : null;
}

function computeRepairs(lines) {
  const figures = findFigures(lines);
  const repairs = [];
  let figureNum = 1;

  for (const fig of figures) {
    const caption = lines[fig.captionLineIdx];
    const captionMatch = caption.match(/<figcaption>(.*?)<\/figcaption>/s);
    if (!captionMatch) {
      figureNum++;
      continue;
    }

    const captionText = captionMatch[1];
    let newCaption = caption;

    if (captionText.includes('View full data') && !captionText.match(/^Figure \d+ —/)) {
      const url = extractSheetUrl(captionText) || '#';
      newCaption = `  <figcaption>Figure ${figureNum} — [Add description]<br><a href="${url}">View full data table</a></figcaption>`;
    } else if (captionText.match(/^Figure \d+/)) {
      const rest = captionText.replace(/^Figure \d+[\s:—]+/, '');
      newCaption = `  <figcaption>Figure ${figureNum} — ${rest}</figcaption>`;
    }

    if (newCaption !== caption) {
      repairs.push({ lineIdx: fig.captionLineIdx, oldLine: caption, newLine: newCaption });
    }

    figureNum++;
  }

  return repairs;
}

module.exports = { findFigures, extractSheetUrl, computeRepairs };
