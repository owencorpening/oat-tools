# Repository Refactor Plan

This plan treats `~/dev/wraith` as the current mixed workspace, not the final
architecture. The target is repos named by role and lifecycle, with Cloudflare D1
holding operational relationships that do not belong in Git.

## Why Split

The current `wraith` repo mixes several concerns:

- Source drafts and published-content preparation.
- Standards, templates, CSS, and SOPs.
- Scripts and tools.
- Brand assets.
- Image/assets experiments.
- Personal and bio archive material.
- Technical idea incubators.
- Generated context dumps and imports.
- Sensitive or special-purpose project material.

That makes backups, publishing, permissions, audience data, and automation harder
than they need to be. The split should make each repo answer one question:

> What is this repo used for?

## Proposed Repos

| Repo role | Suggested repo | Current source |
|-----------|----------------|----------------|
| Content source | `oat-content` | `substack-ideas/`, `linkedin-ideas/`, content inventory, publishing calendar |
| Content standards | `oat-standards` | `standards/`, reusable templates, `Applied-Thinking.css`, platform bios, CTA blocks |
| Public assets | `oat-assets` or keep `images` | Current `~/dev/images`, plus any final public assets stranded in `wraith/images/` or article folders |
| Tools and extensions | `oat-tools` or keep `oat-tools-vscode` | VS Code extensions, table/image pipeline code, reusable scripts that should be productized |
| Publishing platform | `oat-publishing-platform` | Cloudflare Workers, D1 migrations, queue/ledger API, capture endpoints, future audience/subscription integration |
| Research and ideas | `oat-lab` | `technical-ideas/`, `stubs/`, exploratory widgets, prototypes, experiments |
| Personal archive | `oat-private-archive` | `bio/`, autobiography, family stories source material, private notes |
| Sensitive project archive | separate private repo | `Wraith/` and any controlled/special-purpose material |
| Generated/imported data | no permanent source repo by default | `content-intelligence/imports/`, `repomix-output.xml`, logs, temporary exports |

Names can change. The important part is that repos are named for use, not for the
old workspace name.

For the current inventory of tool-like files and their migration status, see
[../dev/tool-migration-inventory.md](../dev/tool-migration-inventory.md).

## What Belongs In D1 Instead Of Git

Git should not become a database for workflow state or audience relationships.

Use D1 for:

- `content_item`: articles, carousels, posts, tables, series entries.
- `asset`: images, table screenshots, diagrams, source files.
- `asset_placement`: where assets appear in content.
- `publication_event`: channel, published URL, publish date.
- `audience_member`: people/accounts known to the system.
- `subscription`: free, paid, complimentary, trial, cancelled, external.
- `entitlement`: access/benefit state.
- `engagement_event`: optional opens, clicks, replies, comments, referrals, notes.
- Pipeline state: candidate, staged, needs-provenance, ready, publishing, placed,
  discarded, failed.

Do not put audience lists, email addresses, private customer notes, payment
records, API keys, or generated operational state into Git.

## Target Boundaries

### Content Source

Use for source markdown and content planning:

- Article drafts.
- Carousel source markdown.
- Series indexes.
- Publishing calendar.
- Content inventory if it remains hand-edited.
- Per-article notes that are meant to travel with the draft.

Do not keep large generated files, image binaries, virtual environments, imports,
or reusable tools here.

### Content Standards

Use for reusable publishing rules:

- SOPs.
- Templates.
- CSS/themes.
- brand block text.
- platform bios.
- pre-publish review checklists.

These should be reusable by the content repo, tool repo, and future platform
without dragging article drafts along.

### Public Assets

Use for final public assets:

- Published images.
- Published/generated table screenshots.
- Provenance files: `url.txt`, `license.txt`, `photographer.txt`.
- Optional `asset.json` manifest.

Do not keep candidates, failed downloads, AI scratch attempts, or temporary
render files here.

### Tools And Platform

Use the tool repo for code that runs locally or in VS Code.

Use the platform repo for Cloudflare infrastructure:

- Worker APIs.
- D1 schema and migrations.
- Capture endpoints.
- Asset ledger API.
- Future audience/subscription integration.

This can stay together with `oat-tools-vscode` at first, but the boundary should
be clear: extension UI is not the canonical data model.

### Research And Ideas

Use a lab repo for rough technical ideas, prototypes, widgets, and exploratory
notes that are not ready to be content or product code.

This prevents idea clutter from polluting the publishable content repo while
still preserving the work.

### Private And Sensitive Material

Keep personal archive material and sensitive project material out of public
content and public asset repos.

Private material can still be organized and versioned, but its repo permissions,
backup policy, and publication rules should be different.

## Migration Sequence

Do not move everything at once. The current `wraith` repo has uncommitted changes,
so begin with inventory and boundaries.

1. Freeze the target map in this document.
2. Commit or intentionally stash current `wraith` changes before moving files.
3. Add ignore rules for obvious generated outputs:
   - logs
   - repomix/context dumps
   - virtual environments
   - imports that can be regenerated
   - temporary exports
4. Create destination repos with minimal READMEs.
5. Move low-risk reusable standards first.
6. Move content drafts by series.
7. Move public asset strays into the asset repo.
8. Move local scripts into either tools, platform, or lab.
9. Update VS Code settings and scripts to use role-based paths and the D1 image
   ledger.
10. Leave `wraith` as an archived compatibility workspace only after links and
    scripts no longer depend on it.

## Migration Safety Rules

- Preserve published URLs. Never move an already published asset path unless the
  published URL is not referenced anywhere.
- Preserve Git history when it is useful, but do not let history preservation
  block a cleaner boundary.
- Do not move uncommitted user changes.
- Do not commit secrets, audience data, payment data, cookies, or private tokens
  into any repo.
- Keep redirects or compatibility symlinks only as a short migration aid.
- Prefer D1 IDs over repo paths for long-term relationships.

## Open Decisions

- Should `oat-standards` be public, private, or mirrored into content repos?
- Should the publishing platform live inside `oat-tools-vscode` until D1 is
  implemented, or become its own repo immediately?
- Should the asset repo remain Git-backed forever, or should future large assets
  move to object storage while Git keeps manifests/provenance?
- Which content is public source material, and which belongs in a private archive?
- What audience/subscription provider will be authoritative for paid state?
