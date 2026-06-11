# Ad-Hoc Test Data for Image Staging Extension

This folder contains realistic test data for manual testing of the image-staging extension in VSCode.

## Folder Structure

```
test-data/
├── README.md                    # This file
├── downloads/                   # Simulated Downloads folder (copy to ~/Downloads for testing)
│   ├── water-droplet-unsplash.png
│   ├── ocean-wave-pexels.png
│   ├── solar-panel-getty.png
│   ├── wind-turbine-shutterstock.png
│   ├── forest-landscape.png
│   └── ChatGPT Image Jun 10 2026, 03_22_45 PM.png
└── repo/                        # Local test repo structure
    ├── substack-ideas/
    │   ├── water-series/
    │   │   └── part-01-intro.md
    │   └── energy-series/
    │       └── part-02-solar.md
    └── carousels/
        └── ocean-carousel.md
```

## How to Use

### Setup

Run the setup script from the repo root:

```bash
extensions/image-staging/test-data/setup-test.sh
```

This will:

1. Clean up any old test data and ledger
2. Copy fresh test images to `~/Downloads/`
3. Copy fresh repo structure to `~/test-repo-oat/`
4. Start a local D1 ledger server (on port 3001)
5. Configure test workspace to use the local ledger
6. Open VSCode automatically with everything ready

You're now ready to test. Search for "water" or any image name in the OAT Images panel.

### Manual Test Workflows

#### 1. Search + Stage + Place (Substack)

1. Open `repo/substack-ideas/water-series/part-01-intro.md`
2. In the OAT Images panel, search for "water" or "solar"
3. Click "Stage" on a result from Downloads
4. Verify image appears in "Staged Images" section
5. Click "Place Figure" to insert into the markdown
6. Verify:
   - Figure snippet appears in editor
   - Figure number is "1" (first figure)
   - Success message shows "Placed Figure 1 for..."

#### 2. Multiple Placements

1. Keep the same markdown file open
2. Stage and place another image
3. Verify:
   - Second image gets Figure 2
   - Both snippets are in the document
   - Figure numbers auto-increment

#### 3. Carousel Placement

1. Open `repo/carousels/ocean-carousel.md`
2. Stage an image
3. Click "Place Figure"
4. Verify:
   - Placement target is "carousel" (not "substack")
   - Snippet format is for Marp (different from HTML figure)
   - Figure number is "1"

#### 4. Discard Workflow

1. Stage an image (don't place it)
2. Click "Discard" button
3. Verify:
   - Confirmation dialog appears
   - Image disappears from staged list

#### 5. ChatGPT Image Detection

1. Search for "chatgpt" 
2. Select the "ChatGPT Image Jun 10 2026..." file
3. Verify:
   - Marked as "AI generated"
   - Suggests tool as "ChatGPT"
   - Status shows appropriate provenance hint

### Test Image Files

- `water-droplet-unsplash.png` — Generic image, source hint will suggest Unsplash
- `ocean-wave-pexels.png` — Generic image, source hint will suggest Pexels
- `solar-panel-getty.png` — Generic image, source hint will suggest Getty
- `wind-turbine-shutterstock.png` — Generic image, source hint will suggest Shutterstock
- `forest-landscape.png` — Generic image, no source hint
- `ChatGPT Image Jun 10 2026, 03_22_45 PM.png` — Special case for AI-generated detection

All images are minimal 1x1 PNG files for testing filename parsing, not image display.

### Checklist for Full Workflow Test

- [ ] Search for image in Downloads
- [ ] View search results with provenance hints
- [ ] Stage image from search results
- [ ] Verify staged image appears in panel
- [ ] Place image in Substack article
- [ ] Verify figure snippet in editor
- [ ] Verify figure number is correct
- [ ] Place another image and verify numbering increments
- [ ] Test placement in carousel.md
- [ ] Discard an image
- [ ] Verify ChatGPT image is properly detected

### Cleanup

After testing, run the teardown script:

```bash
extensions/image-staging/test-data/teardown-test.sh
```

This will:

1. Stop the local D1 ledger server
2. Remove test images from `~/Downloads/`
3. Remove test repo from `~/test-repo-oat/`

The original files in `extensions/image-staging/test-data/` remain in the repo for future testing.

## Notes

- Images are intentionally minimal (1x1 PNG) to test metadata parsing, not rendering
- File names are realistic and include various provider hints for testing filename analysis
- The repo structure mirrors the actual Substack structure used in the real project
- This test data can be extended with additional files as new workflows are identified
