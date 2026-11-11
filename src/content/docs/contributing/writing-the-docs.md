---
title: "Writing the Docs"
---

The site is [logos-docs](https://github.com/LogosCore/logos-docs): Astro
with Starlight, its pages Markdown files in `src/content/docs/`. The contract
pages state what the code does: each fact is checked in the code (the
protocol's types, the SDKs, core) before it is written.

## Page anatomy

- **Frontmatter.** Every page starts with a `title`: Starlight's docs
  collection requires one, and the build fails without it.

  ```md
  ---
  title: "Changing the Protocol"
  ---
  ```

- **A contract page** gives the contract's facts first, as the code has
  them; then `## Open questions`, when there are any; then
  `## Design notes`, last: why it is the way it is. Each open question and
  each design note is a bullet, a bold lead and then the reasoning:

  ```md
  ## Design notes

  - **Resolved at use.** A target's credentials are resolved for every
    call, so a credential edited reaches every target at the next call.
  ```

  There is no separate decision log: the reasons for a design live in the
  Design notes of the page it belongs to.
- **The voice.** Plain statements of fact in the present tense, in short
  sentences; no marketing, no filler, no first person. "core" in lowercase,
  but at the start of a sentence. Commands, files and identifiers in
  backticks. Tables where a list of like things would run long.

## Status notes

A page about a design that is not fully built says so in an aside at its
top, or at the top of the section the design is:

| Aside | When |
|---|---|
| `:::caution[Draft]` | A design agreed but not built yet: the page records it before the code. |
| `:::note[Status]` | Built in part, or built with something still to come: what is built and released, and what is not, or not yet used or run. |
| none | Built: the page states what the code does. |

```md
:::caution[Draft]
An agreed design, not built yet.
:::
```

When the code lands, check the page against it, drop or update the aside,
and set the contract's status in the [overview's
table](../../contracts/overview/#contracts-in-this-section).

Other asides use Starlight's syntax (`:::note[Title]`, `:::tip`,
`:::caution`, `:::danger`), not MkDocs's `!!! note`. They differ by icon, not
by colour: the site is monochrome, on Tailwind's neutral scale.

## Links

- **Between pages**, relative directory URLs, never `.md`:
  `[Architecture](../architecture/)`, and with an anchor
  `[One core instance](../architecture/#one-core-instance)`. Count the `../`
  from the page's own URL: `contracts/minion-messages/wire-format.md` is
  served at `…/contracts/minion-messages/wire-format/`, so its link to the
  architecture page is `../../../architecture/`.
- **An anchor** is its heading in lowercase, punctuation dropped, spaces as
  hyphens: `` ### `module.register` `` is `#moduleregister`.
- **To the code**, the repository on GitHub:
  `https://github.com/LogosCore/<repository>`.

`npm run check:links` checks every internal link and anchor of the built
site; links outside it are not checked.

## The sidebar

`astro.config.mjs` holds the navigation, Starlight's `sidebar`: each page by
its slug (`contracts/minion-connection`), in its group. A page it does not
list still builds, but nothing leads to it: add, move or rename a page there
too.

## Diagrams

- **Mermaid**, in `mermaid` fences. `astro-mermaid` renders them in the
  browser, not at build time: `npm run build` passes a broken diagram, and
  the page shows an error in its place.
- **`npm run check:diagrams`** parses every diagram as the browser will.
- **No `;` in a sequence diagram's message text**: there it ends the
  statement.

## Building and checking

```bash
npm install
npm run dev              # http://localhost:4321/logos-docs/
npm run check:diagrams   # every diagram parses
npm run build            # the site, in ./dist
npm run check:links      # every internal link and anchor in ./dist resolves
```

- **`npm run build`** fails on a page's frontmatter or content, not on a
  broken diagram or link: run the three checks before a push.
- **The dev server can miss edits** made in quick succession and keep
  serving the old page: touch the file, and it reloads it.
- **Not `npm run build` while the dev server runs**: the build can remove
  `.astro/`, which the dev server loads every page from. If it did,
  `npx astro sync` writes it again.

## Publishing

A push to `main` runs Deploy Docs: `npm ci`, `npm run check:diagrams`,
`npm run build`, `npm run check:links`, then the deploy to GitHub Pages,
<https://logoscore.github.io/logos-docs/>. A check that fails stops the
deploy. The docs have no tags: `main` is the site.

## Keep in step

- **The [contracts overview](../../contracts/overview/#contracts-in-this-section)**:
  each contract's status, when one is agreed, built or released.
- **The minion messages' tables**: the
  [items](../../contracts/minion-messages/#items), and [Mechanics by
  connection kind](../../contracts/minion-messages/#mechanics-by-connection-kind)
  when a mechanic changes on any kind.
- **The wire format's [Registry](../../contracts/minion-messages/wire-format/#registry)**:
  every number the protocol names. The protocol's `TestRegistry` checks the
  same numbers.
- **Examples the protocol's tests copy verbatim**: the [Minion
  Build](../../contracts/minion-build/) page's build schema, build request,
  its reply, progress and results; the [Module
  Management](../../contracts/module-management/#action-conditions) page's
  action conditions; the [Codecs](../../contracts/minion-messages/codecs/#the-json-envelope)
  page's JSON envelope check-in. An edit to one is an edit to
  `logos-golang-protocol`'s tests.
- **Versions**: [Repositories](../repositories/#tags-and-main) and [Protocol
  Releases](../../contracts/protocol-releases/), after a release round.
