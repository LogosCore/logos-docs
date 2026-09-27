# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

This is the **documentation site** for the Logos project — a modular team operations platform. It is an [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/) static site containing Markdown docs and a GitHub Actions deployment pipeline. There is no application code here; the Go packages and modules are in separate repositories.

## Build and Serve

```bash
# One-time setup
npm install

# Local dev server (http://localhost:4321/logos-docs/)
npm run dev

# Production build (used in CI) -> ./dist
npm run build

# Preview the production build
npm run preview
```

`npm run build` fails on content/config errors. Always build locally before pushing.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy-docs.yml`, which builds with Node 20 (`npm ci && npm run build`) and deploys the `dist/` output to GitHub Pages automatically.

## Documentation Structure

Content lives in `src/content/docs/` (English only; the site is single-locale with `defaultLocale: "root"`). Every page needs a `title` in its frontmatter. The navigation hierarchy is defined in `astro.config.mjs` under the Starlight `sidebar` config (using page `slug`s) — always update it when adding or renaming pages.

- **Foundations** — Architecture, requirements, core responsibilities, module taxonomy, full-system message flow
- **Channels** — Channel-specific message flow, contracts, transposition profiles (YAML reference), per-channel module docs (HTTP, Telegram), and the 15-minute channel authoring guide
- **Go Packages Ecosystem** — Docs for shared Go packages: `logos-golang-protocol` (message contracts), `logos-golang-channel-core` (channel runtime SDK)
- **ADR** — Architecture Decision Records

## Key Concepts for Editing Docs

- **Two module types**: Channel Modules (transport) and Minion Factory Modules (build artifacts). Channels are plaintext-blind — they relay encrypted blobs only. Minion factories may optionally implement translator hooks for a custom minion language; these are a factory-owned implementation detail, not a separate module type.
- **Message contracts** are versioned (`inbound.agent_message`, `outbound.agent_message`). The canonical fields are `id` and `encrypted_data`.
- **Transposition profiles** are YAML-defined transport-shaping configurations that map `id`/`encrypted_data` into channel-specific locations using transform chains. The `custom_mapping` block handles channel-specific grouped data.
- **Transform chains** have explicit ordering: outbound applies transforms top-to-bottom, inbound reverses them bottom-to-top.

## Markdown Authoring

- **Frontmatter**: every page must start with a `title:` (Starlight requirement).
- **Asides/callouts**: use Starlight syntax — `:::note[Title]`, `:::tip`, `:::caution`, `:::danger` — not MkDocs `!!! note`.
- **Internal links**: link to other docs with relative directory URLs, e.g. `[Architecture](../architecture/)` or with an anchor `(../architecture/#pending-decisions)`. Do not use `.md` extensions.
- **Mermaid**: fenced code blocks with the `mermaid` language are rendered at build time to inline SVG by the `astro-mermaid` integration (no client-side flash).
- **Tables, TOC, syntax highlighting**: provided out of the box by Starlight.
