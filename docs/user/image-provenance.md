# Image Provenance & Status Workflow

This document explains how images acquire provenance metadata and move through status states in the OAT image pipeline.

## Core Principle

**Provenance** = confidence in knowing who created/owns the image and what you can do with it (license).

The pipeline auto-stages images when it can confidently infer provenance from the source. Otherwise, images remain in `needs-provenance` status pending manual review.

## Image Source Types

### Pexels (Provider API)

**Provenance**: ✅ Complete & guaranteed

When you stage an image from Pexels search:
- Creator: Pexels photographer (from API metadata)
- License: Known (Pexels License)
- Source: Direct API link
- **Status → `staged`** immediately (auto-ready for use)

### Downloads: ChatGPT-generated

**Provenance**: ✅ Inferred from filename

When you have a local file like `ChatGPT Image Jun 2, 2026, 03_10_57 PM.png`:
- Filename pattern detected → tool identified as ChatGPT
- Creator: Owen Corpening (inferred from you running ChatGPT)
- License: ChatGPT (OpenAI ToS: https://openai.com/policies/terms-of-use)
- **Status → `staged`** automatically (filename proves provenance)

**Supported AI Platforms** (filename patterns detected):
- ChatGPT: `ChatGPT Image [Date], [Time] [AM/PM].png`

**Why this works**: If the filename matches ChatGPT's standard format, ChatGPT created it and you own the output under OpenAI's ToS.

### Downloads: Unknown source

**Provenance**: ❌ Unverified

When you download an image with a non-standard filename (e.g., `water.png`, `landscape-01.jpg`):
- Creator: Unknown
- License: Unknown
- Source: Local file only
- **Status → `needs-provenance`** (requires manual review before use)

**What happens next**: Before placing the image, you should:
1. Know/confirm who created it
2. Verify you have permission to use it
3. Add creator and license info

Manual approval happens through the UI when you stage the image—you can edit metadata before clicking Place.

## Status States

| Status | Meaning | Auto-placed? |
|--------|---------|-------------|
| `needs-provenance` | Metadata incomplete; review before use | No |
| `staged` | Ready for placement | Yes |
| `publishing` | Placement in progress | No |
| `published` | Placed and committed | No |
| `discarded` | Rejected; won't be used | No |

## Adding Support for New AI Tools

To add auto-staging for a new AI platform:

1. Update `inferFilenameHints()` in `extensions/image-staging/lib/downloadsProvider.js` to detect the filename pattern
2. Add a case to `licenseForTool()` with the tool name and license/ToS link
3. Document the filename pattern in this file

Example:
```javascript
// Detect "DALL-E Image [date].png"
const dalleImage = baseName.match(/^DALL-E Image (.+)\.png$/);
if (dalleImage) {
  return {
    tool: 'DALL-E',
    title: baseName
  };
}

// In licenseForTool():
case 'DALL-E':
  return 'DALL-E (OpenAI ToS: https://openai.com/policies/terms-of-use)';
```

## Workflow Summary

```
Downloads file found
  ↓
Filename matches known AI platform?
  ├─ Yes → Extract creator & license → Status: staged ✅
  └─ No  → Status: needs-provenance
            ↓
            Manual review → Add creator/license → Status: staged ✅
```

## Why This Matters

- **Copyright**: Ensures you have rights to images before publishing
- **Attribution**: Proper credit to creators (required by licenses)
- **Sustainability**: Files images know their origin, making audits/updates possible
- **Automation**: Auto-staged images can be placed immediately; unverified images require human approval

## See Also

- [image-pipeline-quickstart.md](image-pipeline-quickstart.md) — Quick workflow walkthrough
- [../dev/image-pipeline-architecture.md](../dev/image-pipeline-architecture.md) — Data model and saga design
