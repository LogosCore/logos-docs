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
- **Contracts** — wire contracts between modules and core: AMQP envelope and routing, module lifecycle, HTTP sync (data plane), module management, module logs (live tail), minion connection schema, minion build (built; payload crypto pending), plus the "Implementing a Module" guide (checklist + the Go SDKs: `logos-golang-module-core`, with `logos-golang-channel-core` and `logos-golang-factory-core` on top, and BOB as the reference factory)

There is no ADR section: design reasoning lives in a **Design notes** section at the end of the contract page it belongs to. Contract pages state facts from the code (protocol types, module-core, channel-core, core) — check a field or limit there before documenting it. The exception is a page that opens with a `:::caution[Draft]` aside: it records an agreed design before it is built. When the code lands, check the page against it, drop the aside, and set its status in the overview's contracts table.

## Key Concepts for Editing Docs

- **Two module types**: Channel Modules (transport) and Factory Modules (build minions). Channels are plaintext-blind — they relay encrypted blobs only. Factories may optionally implement translator hooks for a custom minion language (planned, not built); these are a factory-owned implementation detail, not a separate module type. A third type, **dialers** (call minions that only answer, such as a page on a web server, when core asks), is an idea for later, written up in `module-types.md`; not designed or built.
- **The sync call** (data plane) carries a minion's ciphertext as the raw HTTP body, with `Logos-Message-Id`, `Logos-Build-Id` and `Logos-Channel-Instance` headers; core answers 200 with ciphertext or 204 with nothing. There is no JSON envelope any more (`inbound/outbound.minion_message`, `encrypted_data` are gone).
- **Channel extraction** — core defines only the sync call. How a channel module extracts the build id and its ciphertext from its transport is the channel's implementation detail and out of scope for these docs.

## Markdown Authoring

- **Frontmatter**: every page must start with a `title:` (Starlight requirement).
- **Asides/callouts**: use Starlight syntax — `:::note[Title]`, `:::tip`, `:::caution`, `:::danger` — not MkDocs `!!! note`.
- **Internal links**: link to other docs with relative directory URLs, e.g. `[Architecture](../architecture/)` or with an anchor `(../architecture/#pending-decisions)`. Do not use `.md` extensions.
- **Mermaid**: fenced code blocks with the `mermaid` language are rendered at build time to inline SVG by the `astro-mermaid` integration (no client-side flash).
- **Tables, TOC, syntax highlighting**: provided out of the box by Starlight.
- **Monochrome**: the site uses Tailwind's neutral scale, like core's UI, and no other colour. `src/styles/global.css` maps Starlight's tokens (accent, grays, the aside/badge/card hues, print) and the Mermaid diagrams to it; `src/styles/code-theme.mjs` is the grayscale code theme. Asides of different kinds differ by icon (a caution or danger also gets a stronger edge), not hue.
