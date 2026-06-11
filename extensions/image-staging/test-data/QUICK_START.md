# Quick Start: Manual Testing

## One-Command Setup

```bash
extensions/image-staging/test-data/setup-test.sh
```

That's it. VSCode opens automatically with everything ready.

## 5-Minute Test Flow

1. **Open file**: `substack-ideas/water-series/part-01-intro.md`
2. **Search**: Type "water" in OAT Images panel
3. **Stage**: Click "Stage" on a result
4. **Place**: Click "Place Figure" on staged image
5. **Verify**:
   - ✓ Snippet appears in editor
   - ✓ Figure 1 is created
   - ✓ Success message shows

## Useful Test Cases

| Workflow | File | Expected |
| --- | --- | --- |
| **Substack placement** | `substack-ideas/water-series/part-01-intro.md` | Target = "substack", Figure 1 |
| **Carousel placement** | `carousels/ocean-carousel.md` | Target = "carousel", Marp format |
| **Multiple figures** | Place 2+ images | Figure numbers 1, 2, 3... |
| **ChatGPT detection** | Search "chatgpt" | Shows as "AI generated" |
| **Discard** | Stage any image, click Discard | Image removed from list |

## Cleanup

```bash
extensions/image-staging/test-data/teardown-test.sh
```

## Troubleshooting

| Issue | Solution |
| --- | --- |
| No search results | Verify test images are in `~/Downloads/` |
| "Open markdown draft" error | Make sure the .md file is open in editor |
| Figure number off | Check if other figures exist in the document (uses highest + 1) |
| Carousel not detected | File must end with `carousel.md` exactly |

## Common Searches

Try these searches in the OAT panel:

- "water" → finds water-droplet, ocean-wave
- "solar" → finds solar-panel
- "wind" → finds wind-turbine
- "forest" → finds forest-landscape
- "chatgpt" → finds ChatGPT image (tests AI detection)
