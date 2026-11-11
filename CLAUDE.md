# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

The **documentation site** for Logos, a modular team operations platform:
core, its modules (channels and factories), and the minions they serve. It is
an [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/)
static site of Markdown pages, deployed to GitHub Pages. There is no
application code here: the Go packages and modules are in the sibling
repositories, which the site's Contributing → Repositories page maps.

## Build, Check and Serve

```bash
npm install
npm run dev               # http://localhost:4321/logos-docs/
npm run check:diagrams    # every Mermaid diagram parses (scripts/check-diagrams.mjs)
npm run build             # ./dist; fails on content and config errors only
npm run check:links       # every internal link and anchor in ./dist resolves (scripts/check-links.mjs)
```

- **Mermaid renders in the browser** (astro-mermaid turns each block into
  `<pre class="mermaid">`), not at build time: the build passes a broken
  diagram, which shows as a red box of parser tokens. Run `check:diagrams`
  after editing any diagram. In a sequence diagram `;` ends a statement: never
  put one in a message's text.
- **Never run `npm run build` while the dev server runs**: it can remove
  `.astro/` under it, and every page then fails to load. If it happened:
  `npx astro sync`, then touch the edited pages.
- **The dev server can miss quick successive edits** (a scripted multi-edit,
  or several edits within seconds): write a file whole and atomically (a temp
  file, then rename), touch each edited page about 1.5 s apart, and curl it for
  a phrase of the new text.

## Deployment

Every push to `main` runs `.github/workflows/deploy-docs.yml` on Node 20:
`npm ci`, the diagram check, the build, the link check, then the deploy of
`dist/` to GitHub Pages. A failed check stops the deploy.

## Structure

Pages live in `src/content/docs/`; the sidebar and the redirects are in
`astro.config.mjs` (update the sidebar when a page is added, moved or
renamed). The groups:

- **Start here**: `index` (the landing page, with a reading path per reader),
  `architecture` (the parts, how they talk, and the built/planned table: the
  one status list), `module-types`, `core-responsibilities`,
  `core-infrastructure`, `glossary`.
- **Guides**: `implementing-a-module` (what every module does, the Go SDKs),
  `guides/writing-a-channel`, `guides/writing-a-factory`,
  `guides/writing-a-minion`.
- **Contracts**: `contracts/overview` (how modules reach core, and the
  contracts table with each one's status), `contracts/protocol-releases`
  (generated from `logos-golang-protocol`'s tags: add the new version when the
  protocol is tagged), then the module plumbing (AMQP envelope and routing,
  lifecycle, management, logs), the channel contracts (minion connection
  schema, HTTP sync, connections, agentless channels, and `modules/ssh` for
  the SSH module), the build contracts (minion build, credentials), and the
  minion's protocol (`contracts/minion-messages/*`, with task results and
  actions, the file browser and the VPN front).
- **Contributing**: `contributing/*`: repositories, development stack,
  testing and CI, changing the protocol (and releasing), architecture rules,
  writing the docs (`contributing/writing-the-docs.md` holds the page
  conventions).

Retired pages keep their URLs through redirects (`message-flow`,
`message-flow-full`). Other repositories link to `core-infrastructure`,
`contracts/channel-core-connections`, `contracts/channel-core-sync`,
`contracts/minion-connection`, `contracts/minion-messages` (and its `codecs`)
and `contracts/vpn-front`: keep those slugs, or add a redirect.

## Writing Rules

The site's Contributing → Writing the Docs page is the reference; in short:

- **Contract pages state facts from the code** (the protocol's types, the
  SDKs, core): check a field, limit or name there before documenting it. A
  page's design reasoning goes in a **Design notes** section at its end, each
  note a bold lead, then why. There is no ADR section.
- **Status notes**: `:::caution[Draft]` opens a page about an agreed design
  not built yet; `:::note[Status]` one built in part, saying what is not; a
  built page has none, and the overview's contracts table says it is built.
  Release histories do not go in pages: versions are on Protocol Releases.
- **One home per fact**: link instead of restating. The kinds table and the
  three paths (Connections), the sync call's answers (HTTP Sync), lost
  replies and replays (Wire Format, "Freshness and replay"), the item numbers
  (the wire format's Registry).
- **Keep in step**: the overview's contracts table, the minion messages'
  "Mechanics by connection kind" table, the wire format's Registry, and the
  protocol's tests that copy the docs' JSON examples verbatim (in
  `logos-golang-protocol`: the build schema, build request and action
  conditions examples).
- **Links**: relative directory URLs (`../architecture/`,
  `../contracts/minion-build/#targets`), never `.md`.
- **Asides**: Starlight's (`:::note`, `:::tip`, `:::caution`, `:::danger`),
  not MkDocs' `!!! note`.
- **Words**: "minion" for what a factory builds; "core" in lowercase; "the id
  it was sent under" (the build's, the temporary one, the session's), not "the
  build id", for what a channel hands core.
- **Monochrome**: the site uses Tailwind's neutral scale and no other colour
  (`src/styles/global.css` maps Starlight's tokens and the diagrams; the code
  theme is `src/styles/code-theme.mjs`). Asides differ by icon, not hue.

## Key Facts for Writing

Each has a page with the detail; check it there, and in the code, before
writing about it.

- **Two module types**: channels carry minion traffic over a transport and
  stay plaintext-blind; factories build minions. Modules talk only to core.
- **Connection kinds** (`reverse-call`, `reverse-persistent`, `bind-call`,
  `bind-persistent`) and the **three paths** to core (the sync call, a
  connection socket per minion connection, the control link): Connections.
  Failover between a build's connections is built; `add_connection` is a
  draft there.
- **The sync call** carries the sealed frame as the raw body with
  `Logos-Message-Id`, `Logos-Build-Id` and `Logos-Channel-Instance` headers;
  core answers 200 with its reply or 204 with none, 409 for a replay and 422
  for a frame that does not open, among others (HTTP Sync). A message sent
  again within 10 minutes gets the reply it got: core keys this on the
  minion's own message id, not on `Logos-Message-Id`.
- **Agentless channels** act as the minion (the SSH channel: `modules/ssh`):
  core gives them the keys of the ids they serve (key 11) and the acting task
  (key 14) with each call and open.
- **Numbers**: every channel, build field, connection parameter, kind field
  and target field is numbered (one numbering per schema; a number is never
  reused); commands by `op`, params by `num`. A minion reads the **minion
  config** (numbered CBOR, Minion Build) by numbers alone.
- **The minion's protocol** (Minion Messages): sealed frames
  (`aes-256-cbc-hmac-sha256`), CBOR or JSON envelopes or a factory's own
  (Codecs, over the factory link), staging then a lone `hello`, `get_tasks`,
  tasks and results, file transfers and streams, identity, tunnels (core's
  fronts on its operational ports, the VPN front), delegation, compression
  (the packed item). Writing a Minion says what a minion must implement and
  what is optional.
- **Credentials**: credential fields in connection and build schemas; core
  hands modules the credentials an id names (Credentials).
- **Minion error codes**: what a factory's minions' exit codes mean, declared
  in its build schema and shown to operators (Minion Build).
- **No backward compatibility for now** (pre-1.0): names are renamed or
  removed without aliases, and the repositories a change affects move in the
  same release round (Changing the Protocol).
