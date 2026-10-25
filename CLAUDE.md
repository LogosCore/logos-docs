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
- **Channels** — Channel message flow and envelope contract with core
- **Contracts** — wire contracts between modules and core: AMQP envelope and routing, module lifecycle, HTTP sync (data plane), module management, module logs (live tail), plus the "Implementing a Module" guide (checklist + `logos-golang-channel-core` SDK)

There is no ADR section: design reasoning lives in a **Design notes** section at the end of the contract page it belongs to. Contract pages state facts from the code (protocol types, channel-core, core) — check a field or limit there before documenting it.

## Key Concepts for Editing Docs

- **Two module types**: Channel Modules (transport) and Minion Factory Modules (build artifacts). Channels are plaintext-blind — they relay encrypted blobs only. Minion factories may optionally implement translator hooks for a custom minion language; these are a factory-owned implementation detail, not a separate module type.
- **Message contracts** are versioned (`inbound.minion_message`, `outbound.minion_message`). The canonical fields are `id` and `encrypted_data`.
- **Envelope contract** — core defines only the canonical envelope format. How a channel module extracts `id` + `encrypted_data` from its transport is the channel's implementation detail and out of scope for these docs.

## Markdown Authoring

- **Frontmatter**: every page must start with a `title:` (Starlight requirement).
- **Asides/callouts**: use Starlight syntax — `:::note[Title]`, `:::tip`, `:::caution`, `:::danger` — not MkDocs `!!! note`.
- **Internal links**: link to other docs with relative directory URLs, e.g. `[Architecture](../architecture/)` or with an anchor `(../architecture/#pending-decisions)`. Do not use `.md` extensions.
- **Mermaid**: fenced code blocks with the `mermaid` language are rendered at build time to inline SVG by the `astro-mermaid` integration (no client-side flash).
- **Tables, TOC, syntax highlighting**: provided out of the box by Starlight.
