'use strict';

function buildSnippet({ target, imageUrl, displayName, name, figNum, figureNumber, caption, attribution, photographer, license }) {
  const desc = humanize(displayName || name);
  const attr = caption || attribution || `Image by ${photographer}, ${license}.`;
  const figure = figureNumber || figNum;

  switch (target) {
    case 'substack':
      return `<figure>\n  <img src="${imageUrl}" width="700" alt="${desc}">\n  <figcaption>${figureCaption({ figure, caption: attr })}</figcaption>\n</figure>\n\n`;
    case 'carousel':
      return `![bg left:40%](${imageUrl})`;
    case 'linkedin-post':
      return `Image URL: ${imageUrl}\nPhotographer: ${photographer} | License: ${license}\n(Attach manually in LinkedIn editor.)`;
    default:
      return imageUrl;
  }
}

function figureCaption({ figure, caption }) {
  const clean = String(caption || '').trim();
  if (/^Figure\s+\d+:/i.test(clean)) return clean;
  return `Figure ${figure}: ${clean}`;
}

function humanize(s) {
  return String(s || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, c => c.toUpperCase())
    .trim();
}

module.exports = {
  buildSnippet,
  figureCaption,
  humanize
};
