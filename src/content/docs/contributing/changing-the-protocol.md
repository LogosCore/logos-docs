---
title: "Changing the Protocol"
---

`logos-golang-protocol` holds what every part of Logos shares: core, the
SDKs, every module and its minions, and logos-vpn. A change to it is a change
to a contract. It is written on the contract's page first, built against the
unreleased checkout, and released in one round across every repository it
reaches.

## The format rules

- **Numbers, never reused.** Every key, item type and closed value of the
  minion messages has a number in the wire format's
  [Registry](../../contracts/minion-messages/wire-format/#registry), and so
  does every field of a connection or build schema, every command (`op`)
  and every param (`num`), in its schema ([Field
  numbers](../../contracts/minion-connection/#field-numbers),
  [Commands](../../contracts/minion-build/#commands)). A new one takes a
  number never used before; one that goes leaves its number unused, since
  minions keep the numbers they were built with. The protocol's
  `TestRegistry` fails when a number moves.
- **Receivers ignore what they do not know**, so an optional key needs no new
  message version. The exceptions, and what a change that breaks the rules
  needs, are in [Changing these
  formats](../../contracts/minion-messages/#changing-these-formats), with
  the checklist a new mechanic answers to work on all four connection kinds:
  answer it on the contract page. The control plane's envelope has the same
  rule for unknown fields ([AMQP Envelope](../../contracts/amqp-envelope/#conventions)).
- **One set of checks.** Core checks what modules and minions send with the
  protocol's own validators (`protocol.ValidateBuildMessage`,
  `ValidateMessageHead`, `ValidateBuildRequest`, …), which a module's tests
  can run too ([Testing and CI](../testing-and-ci/#before-a-push)).

## Documentation first

- **The design goes on its contract page before the code.** A page about a
  design agreed but not built yet opens with a `:::caution[Draft]` aside
  ([Status notes](../writing-the-docs/#status-notes)), and the reasons for
  it go in the page's Design notes. When the code lands, the page is checked
  against it, the aside goes, and the contract's status changes in the
  [overview's table](../../contracts/overview/#contracts-in-this-section).
- **The tables go with it**: a new number into the
  [Registry](../../contracts/minion-messages/wire-format/#registry), a new
  item into the [items table](../../contracts/minion-messages/#items), a new
  mechanic into [Mechanics by connection
  kind](../../contracts/minion-messages/#mechanics-by-connection-kind).
- **Some examples are tests.** The protocol's tests copy examples of the
  docs verbatim: the Minion Build page's build schema, build request, its
  reply, progress and results; the Module Management page's action
  conditions; the Codecs page's JSON envelope check-in. Change one, and the
  test changes with it.

## Working against an unreleased protocol

Until the protocol is tagged, the repositories that need the change build
against its checkout. The wiring is local and never committed
([below](#never-committed-never-tagged)), and its paths are relative,
checkouts side by side ([Development
Stack](../development-stack/#prerequisites)), but for BOB's minion.

### A module repository

A `go.work` at its root:

```
go 1.25.7

use (
	.
	../logos-golang-protocol
)
```

Other checkouts a change needs join it (logos-ssh's names
`../logos-golang-channel-core` as well). logos-vpn takes the same.

### Core

core-dev builds core from the checkout's `core/`, mounted at `/app`, so the
workspace has to resolve on the host and in the container alike. `core/go.work`:

```
go 1.25.7

use (
	.
	../../logos-golang-protocol
)
```

and a `docker-compose.override.yml` at the root of `logos-core`, which
Compose reads beside `docker-compose.yml`:

```yaml
services:
  core-dev:
    volumes:
      - ../logos-golang-protocol:/logos-golang-protocol:ro
```

In the container, `../../logos-golang-protocol` from `/app` is
`/logos-golang-protocol`, where the override mounts the checkout. Then
recreate core-dev, which adds the mount:

```bash
docker compose --profile development up -d core-dev
```

- **Both at once, then the recreate.** air rebuilds core on the next Go edit,
  and with a `go.work` naming a folder the container lacks, every build
  fails and core stays down (nginx answers 502). Undo it the other way
  round: `core/go.work` first, then the override, then recreate core-dev.
- **`go 1.25.7`, by hand.** The container's Go is 1.25 and fetches no other
  toolchain, while `go work init` writes the version of the Go that runs it.
- **A protocol edit needs a restart.** air does not watch the checkout:
  after changing it, `docker restart logos-core-dev`.

### A module's dev container

A module's image builds from the tagged modules alone: logos-tcp-channel's,
logos-dumbo's and logos-ssh's `.dockerignore` keep the workspace out of it,
and in the other repositories an image built with a `go.work` present fails.
So the dev container runs a binary built on the host:

```bash
CGO_ENABLED=0 GOOS=linux go build -o .dev-bin/http-channel ./cmd/http-channel
```

which a `docker-compose.override.yml` mounts over the image's:

```yaml
services:
  http-channel:
    volumes:
      - ./.dev-bin/http-channel:/app/http-channel:ro
```

Then `docker compose up -d`, without `--build`. After each change, build the
binary again and `docker compose restart`. Every image keeps its programs in
`/app`: `/app/tcp-channel`, `/app/dumbo-channel` and `/app/dumbo-factory`,
`/app/ssh-channel` and `/app/ssh-factory`, `/app/raven-factory`,
`/app/bob-factory`.

### BOB

BOB compiles its minion for each build from a copy of `minion/` in a
scratch folder, where no workspace applies and no relative path resolves.
While the minion needs the checkout:

- BOB's `go.work` uses `./minion` too: go commands run in `minion/` refuse a
  workspace that leaves its module out.

  ```
  go 1.25.7

  use (
  	.
  	./minion
  	../logos-golang-protocol
  )
  ```

- `minion/go.mod` replaces the protocol with the checkout, by its absolute
  path:

  ```
  replace github.com/logoscore/logos-golang-protocol => /path/to/logos-golang-protocol
  ```

- The factory's binary is built on the host, as above
  (`CGO_ENABLED=0 GOOS=linux go build -o .dev-bin/bob-factory ./cmd/bob-factory`),
  and the override mounts it, the minion's sources, and the checkout at that
  same absolute path:

  ```yaml
  services:
    bob-factory:
      volumes:
        - ./.dev-bin/bob-factory:/app/bob-factory:ro
        - ./minion:/app/minion:ro
        - /path/to/logos-golang-protocol:/path/to/logos-golang-protocol:ro
  ```

### Never committed, never tagged

The wiring is a developer's own: `go.work`, `go.work.sum`,
`docker-compose.override.yml`, `.dev-bin/`, and a `replace` naming a
checkout. Keep it out of commits: logos-dumbo's and logos-raven's
`.gitignore` list those files, logos-vpn's `go.work` and `go.work.sum`;
elsewhere, list them in `.git/info/exclude`. A release drops the wiring before it checks a
repository, `core/go.work` and BOB's `minion/go.mod` included. BOB v0.35.0
was tagged with its minion's `replace` still in place: its image could not
compile a minion ("replacement directory … does not exist"), and every
build failed until v0.36.0.

## Releasing

A release goes in rounds. A round names the repositories it changes, each
with its bump and its commit message, and goes through them in layers, in
[dependency order](../repositories/#dependency-order): a layer is checked,
tagged and pushed before the next takes its tags. For each repository of a
layer:

1. **Drop the dev wiring.**
2. **Take the round's tags**:
   `go get github.com/logoscore/logos-golang-protocol@v0.51.0` (and each
   other Logos module the round tagged), then `go mod tidy`. A repository
   the round leaves out keeps the tags it has, and moves when a round
   includes it.
3. **Check it**: everything in [What a release
   checks](../testing-and-ci/#what-a-release-checks) passes, lint at
   exactly 0 issues. Nothing is tagged on a failure.
4. **Commit, tag and push**: an annotated tag, its message
   `v0.51.0: <the commit's subject>`, then `main` and the tag. Raven and
   logos-vpn push `main` first and are tagged once its CI has passed: their
   Windows PowerShell 5.1 jobs run only on GitHub, and logos-vpn's Release
   builds from the caches `main`'s CI leaves.

The next layer goes at once: CI and the image builds fetch Logos modules
straight from GitHub (`GOPRIVATE`), so a tag is there the moment it is
pushed.

### Bumps

| Change | Version |
|---|---|
| The protocol: anything on the wire or in a schema | minor, while the protocol is `v0` |
| The protocol: a fix that changes no format | patch |
| An SDK: new API | minor |
| An SDK: a fix, or new tags of what it requires | patch |
| A module: a feature (fields, commands, what it does) | minor |
| A module: new tags of what it requires, nothing else | patch |
| Tests or CI alone | no tag: to `main` |
| Core, the docs | never tagged: `main` is their release |

A breaking change takes a minor like any other, and every repository it
reaches moves in the same round ([below](#no-backward-compatibility-for-now)).
A module's image and logos-vpn's binaries are built from tags alone: a
change to a Dockerfile or to the release build ships with the next tag.

### Core and logos-vpn

Core's images carry the logos-vpn release that `core/vpn-client.version`
names, fetched and checked against its `SHA256SUMS` while the image builds; a
release missing there fails the build. So when a round tags logos-vpn and
includes core, that file takes the new tag, core goes in the layer after
logos-vpn, and core is pushed once the tag's runs have passed and its Release
has uploaded the binaries and installers. core-dev is then rebuilt
(`make services-rebuild`), not restarted: its image holds them.

### After a round

- **CI passes** for every commit pushed, and the tags have built what they
  publish: the modules' images, logos-vpn's release. Core's images come from
  its push to `main`.
- **The dev stack takes the release.** In each released module repository,
  `docker compose build` and `docker compose up -d`. core-dev is restarted
  when core's `go.mod` moved (air does not watch it), and recreated when its
  override was dropped, so the checkout's mount goes too.
- **The versions** in [Repositories](../repositories/#tags-and-main) and the
  new protocol's line in [Protocol
  Releases](../../contracts/protocol-releases/) follow the round.

## No backward compatibility, for now

While Logos is before 1.0, a change does not keep the old way working: the
maintainers' decision of 2026-11-07.

- **Rename or remove freely**: no aliases, no compatibility fields, no
  migrations.
- **A build made before such a change is built again.** When protocol
  v0.38.0 replaced `socks_proxy`, `port_forward` and `reverse_port_forward`
  with `tunnel` and `reverse_tunnel`, earlier builds were left without a
  tunnel command
  ([Tunnels](../../contracts/minion-messages/tunnels/#1-the-front-a-core-param)).
- **Every repository moves in the same round**: core, the SDKs, the modules
  and their minions take the new protocol together.
