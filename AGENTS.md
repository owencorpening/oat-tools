# AGENTS.md

## Project purpose

This repository contains a VS Code extension for Owen's Applied Thinking publishing workflow.

The extension helps select, browse, stage, and inject images into Markdown articles using established OAT SOP protocols. It supports local image sources such as Downloads and remote image metadata backed by Cloudflare Workers and D1.

## Shared references

- Treat `oat-standards` as the shared source of truth for brand, naming,
  and structural conventions.
- Cross-repo open items (decisions, loose ends with no obvious repo home)
  are tracked in `oat-standards/todo.md`.

## Core workflow

- Preserve the user's Markdown publishing conventions.
- Image insertion must follow the repository SOPs.
- Do not invent new Markdown image formats unless explicitly requested.
- Prefer small, reviewable changes.
- Do not rewrite unrelated files.
- Do not change Cloudflare Worker or D1 schema behavior without explaining the migration impact.

## Technical stack

- VS Code extension API
- TypeScript / JavaScript
- Cloudflare Workers
- Cloudflare D1
- Markdown generation
- Local filesystem image browsing

## Coding rules

- Keep extension commands explicit and discoverable.
- Separate UI logic, filesystem logic, D1/Worker API calls, and Markdown generation.
- Add or update tests/scripts when behavior changes.
- Prefer clear names over clever abstractions.
- Before finishing, summarize changed files and any manual verification steps.

## Safety rules

- Never delete local images.
- Never overwrite Markdown content without user confirmation.
- Never expose API tokens or secrets.
- Do not commit generated credentials, `.env` files, or Cloudflare secrets.

## OAT publishing rules

- Maintain mobile-readable Markdown.
- Respect existing SOP protocols for image paths, captions, alt text, and insertion position.
- When uncertain, inspect the SOP files before modifying insertion behavior.