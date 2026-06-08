# Image Notebook Quickstart

Use this when you want the shortest path from an image idea to a planned image
placement.

Primary actor: an author reviewing a draft markdown file.

The image notebook is where the tool tracks possible images, why you need them,
where they should go, and what should happen next.

Current side-effect boundary: copying placement instructions is still available
as a dry handoff. The guarded execute command asks before it moves files, edits
your draft, commits and pushes Git changes, or marks the image fully placed.

## Setup

1. Ask Codex to start the image notebook service, or point VS Code at an already
   running one.
2. Set `oatImages.ledgerApiUrl` in VS Code. For local development, use
   `http://127.0.0.1:8787`.
3. Optionally set `oatImages.ledgerApiToken`.
4. Install the D1 image capture bookmarklet from
   [../tools/bookmarklet/README.md](../tools/bookmarklet/README.md) if you want
   one-click web capture outside VS Code.
5. Optionally set `oatImages.imagesRepoPath`; otherwise the prepare command uses
   `~/dev/images`.
6. Open the target markdown draft in VS Code.

## The Short Flow

```mermaid
flowchart LR
  A[Author reviews draft] --> B{Image needed?}
  B --> C[Download to Downloads]
  B --> D[Capture with bookmarklet]
  B --> E[Use staged sidebar image]
  B --> F[Search inside VS Code]
  C --> G[Intake local file]
  D --> H[Review staged image]
  F --> H
  E --> H
  G --> H
  H --> I[Click Place]
  I --> J[Create planned placement]
  J --> K[Execute planned placement]
```

## Seven Frames

Frame 1: Notice the image opportunity.

- While reviewing the markdown draft, the author sees a spot where an image
  should go.
- If the image is already staged, skip to Frame 3.
- If the author needs to find one, use the bookmarklet path, the Downloads path,
  or future in-VS-Code provider search.

Frame 2: Add an image to the notebook.

- Current browser search shortcut: in Chrome, type `fi<Tab>` and a search term
  such as `wetland`. The shortcut expands to
  `site:unsplash.com OR site:pexels.com OR site:pixabay.com wetland`.
  Treat the results page as discovery only: it can still show images, previews,
  or linked pages from other sites.
- For one-click browser capture, click the OAT D1 image capture bookmarklet.
- For a browsed image downloaded to `~/Downloads`, run
  `OAT Images: Intake Local File`.
- For a spontaneous AI/tool output in `~/Downloads`, use the same local-file
  intake path. Filenames can prefill hints such as tool, timestamp, subject, or
  style, but the author should confirm provenance before placement.
- For a URL copied manually, run `OAT Images: Intake URL`.
- For a late-review visual gap, run `OAT Images: Create Review Image Need`.
- Some image sites bury the actual downloadable image behind detail pages,
  visit buttons, redirects, or dynamic markup. Prefer the bookmarklet or
  provider-backed search when possible because the Worker can resolve
  source-page metadata into a direct image URL and provenance.

Frame 3: Open the staging panel.

- Open the `OAT Image Staging` activity bar view.
- Run `OAT Images: Refresh Image Panel` if the panel looks stale.
- With `oatImages.ledgerApiUrl` set, the panel reads staged images from the
  notebook.

Frame 4: Plan a placement.

- Open the target markdown draft.
- In the image panel, click `Place` on a staged image.
- Pick `substack`, `carousel`, or `linkedin-post`.
- Enter the figure number or handoff label.

Frame 5: Confirm the planned work exists.

- Run `OAT Images: List Planned Image Placements`.
- Pick a placement to copy its notebook record if you want to inspect it.

Frame 6: Copy placement instructions.

- Run `OAT Images: Prepare Planned Placement Run`.
- Pick the planned placement.
- The command copies placement instructions to the clipboard.

Frame 7: Execute when ready.

The copied instructions are for the next automation step. They include:

- where the image repo lives
- which image to place
- where it should go
- which planned placement should be updated
- whether the automation should download and commit the image

The safe stopping point is the copied JSON from `Prepare Planned Placement Run`.
When you are ready for local side effects, run
`OAT Images: Execute Planned Placement Run`. It confirms before writing asset
files, committing and pushing them, inserting or replacing the draft snippet, and
marking the placement as done.

## Most Common Path

1. Review the markdown draft until an image opportunity appears.
2. Capture an image with the bookmarklet, intake a downloaded file, or choose an
   existing staged image from the sidebar. Future provider search in VS Code
   should become the smoothest path.
3. Open `OAT Image Staging`.
4. Click `Place` on the staged image.
5. Run `OAT Images: Prepare Planned Placement Run`.
6. Run `OAT Images: Execute Planned Placement Run` when the draft is open and
   you are ready to write files and update the ledger.

## Command Cheat Sheet

| Goal | Command |
|------|---------|
| Capture a browser image | D1 image capture bookmarklet in `tools/bookmarklet` |
| Add a web image | `OAT Images: Intake URL` |
| Add a local image | `OAT Images: Intake Local File` |
| Record a late visual gap | `OAT Images: Create Review Image Need` |
| Refresh the panel | `OAT Images: Refresh Image Panel` |
| See open needs | `OAT Images: List Open Image Needs` |
| See staged images | `OAT Images: List Staged Notebook Images` |
| See planned placements | `OAT Images: List Planned Image Placements` |
| Copy placement instructions | `OAT Images: Prepare Planned Placement Run` |
| Place image locally | `OAT Images: Execute Planned Placement Run` |

## If Something Feels Off

- No staged assets: confirm `oatImages.ledgerApiUrl` is set and the notebook
  service is running.
- Prepare command has no placements: click `Place` on a staged image first.
- Placement instructions have the wrong repo path: set
  `oatImages.imagesRepoPath`.

## Technical Translation

- Image notebook = the human-facing image ledger.
- The publishing ledger is backed by Cloudflare D1 in this stack.
- The notebook service is the ledger Worker.
- The browser bookmarklet posts to the ledger Worker at `POST /captures/image`;
  it does not write to Google Sheets.
- The ledger Worker can use optional `UNSPLASH_ACCESS_KEY` and
  `PEXELS_ACCESS_KEY` secrets to enrich captured photographer metadata.
- Local development can run through `npm run ledger:dev:node` when Wrangler's
  local D1 runtime is unavailable.
- Placement instructions are JSON shaped for `imagePipeline.placeAsset`.
- The execute command runs `imagePipeline.placeAsset` through the ledger Worker
  lifecycle endpoints.

## Where To Read More

- [use-cases.md](use-cases.md) explains the workflows in more detail.
- [image-provider-search-plan.md](image-provider-search-plan.md) captures the
  plan for in-editor provider search while preserving bookmarklet and Downloads
  intake.
- [image-pipeline-architecture.md](image-pipeline-architecture.md) explains the
  data model, saga, and repo boundaries.
- [../tools/d1/README.md](../tools/d1/README.md) explains the Cloudflare D1
  Worker setup.
