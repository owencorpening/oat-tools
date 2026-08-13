# OAT Publishing Tools

This directory holds local tools that are reusable across content repos and
publishing workflows. It is for productized or near-productized utilities, not
one-off article drafts, private notes, generated outputs, or credential-bearing
scripts.

## Tools

| Tool | Purpose |
|------|---------|
| `assets/validate-provenance.js` | Checks final asset folders for required provenance files. |
| `carousels/export-carousel.js` | Exports Marp carousel markdown to PDF with the OAT content standards theme. |
| `blockiness/blockiness-report.js` | Scores articles for text-blockiness to triage pullquote candidates; optional `--classify-lists` pass flags bullet lists that are actually disguised tables/arguments/paragraphs. |

Blockquote/pullquote rendering moved to the `table-tools` VS Code extension
(`OAT Tables: Promote Selection as Pullquote` / `Promote All Pullquotes in
Document`) — see `blockquotes/README.md`.

## Boundaries

Keep tools here when they:

- Are reusable across more than one article or repo.
- Operate on content, assets, or publishing workflow state.
- Can be documented and tested without private data.
- Do not require committed credentials, cookies, or private audience records.

Do not keep tools here when they:

- Are exploratory prototypes. Put those in the lab repo.
- Are private archive utilities.
- Require browser cookies, local-only secrets, or uncommitted credentials.
- Produce generated context dumps, logs, or temporary exports.
