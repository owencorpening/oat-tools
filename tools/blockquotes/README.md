# Blockquote / Pullquote Rendering — Retired

The Python CLI that used to live here (`blockquote-renderer.py`) has been
retired in favor of the `table-tools` VS Code extension, which now covers both
the batch and one-off cases with a single renderer and one visual style:

- `OAT Tables: Promote Selection as Pullquote` — render whatever text is
  currently selected.
- `OAT Tables: Promote All Pullquotes in Document` — scan the active markdown
  file for every `>` blockquote and promote each one in place.

Both commands render the PNG, commit + push it to the images repo, and replace
the markdown text with the `<img>` embed automatically — no manual URL
copy/paste step, which the old CLI required.

See `oat-standards/sops/actions/sop-blockquote-image.md` for the full workflow and
design spec.
