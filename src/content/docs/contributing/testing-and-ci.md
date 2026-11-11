---
title: "Testing and CI"
---

Every repository's checks run locally before a push, and CI runs most of
them again on GitHub. A release checks more than CI does
([What a release checks](#what-a-release-checks)).

## Before a push

Every Go repository builds, vets, tests and lints:

```bash
go build ./...
go vet ./...
go test ./...
golangci-lint run ./...
```

What each adds:

| Repository | Adds |
|---|---|
| `logos-golang-protocol` | The 32-bit builds ([below](#extra-checks)). |
| `logos-http-channel` | Its tests run against a stand-in for core's sync endpoint, built into them. |
| `logos-tcp-channel`, `logos-ssh` | `go test -race ./...`. logos-ssh's tests log in to an SSH server run in the test's own process, on Unix. |
| `logos-dumbo` | PHP for the page tests. |
| `logos-raven` | PowerShell for the script tests. |
| `logos-bob-factory` | The same checks again in `minion/`, a module of its own. |
| `logos-golang-factory-core` | An opt-in integration test on a real RabbitMQ. |
| `logos-vpn` | `make test` (`go test -race ./...`), `make lint` (golangci-lint for Linux, macOS and Windows), `make dist` (the six binaries). |
| `logos-core` | `make -s test`, `cd core && golangci-lint run`, `cd core && go mod tidy -diff`; the web app's and hocuspocus's checks; the integration tests ([below](#core)). |
| `logos-docs` | `npm run check:diagrams`, `npm run build`, `npm run check:links` ([Writing the Docs](../writing-the-docs/#building-and-checking)). |

**Lint.** golangci-lint v2.13.2 everywhere. The repositories other than
core run its default linters with no configuration file, kept at 0 issues: a
finding is fixed, not excluded (an explicit `_ =` with the reason, for a
`Close` whose error says nothing). Core's `core/.golangci.yml` enables more,
and is kept green the same way: a linter that fires on existing code gets the
code fixed, or stays out with a note in the file saying why. By default
golangci-lint lists at most 50 issues per linter and 3 of the same kind;
`--max-issues-per-linter 0 --max-same-issues 0` lists every one.

**What a module sends.** logos-ssh's tests check every item its minion sends
with the protocol's validators, the ones core checks with (`checkItems`): core
refuses what they refuse.

## Extra checks

- **The protocol on 32 bits.** Minions are built for 32-bit platforms
  (`windows/386`, `linux/386`), so the protocol must compile where `int` is
  32 bits:

  ```bash
  GOARCH=386 go vet ./...
  GOOS=windows GOARCH=386 go build ./...
  GOARCH=arm go build ./...
  ```

- **BOB's minion is a Go module of its own** (`minion/`): `go test ./...`
  at the root does not reach it. Build, vet and test it in `minion/`, and
  check it for the platforms it is built for, since nothing in the tests runs
  on them: vet and lint it with `GOOS=windows` for `amd64` and `386`, and
  vet it with `GOARCH=386`. Its compile tests need `go` on `PATH`.
- **Dumbo's page under PHP.** The page tests run the generated page under
  PHP's built-in server and speak to it as core does; `TestChannelCallsThePage`
  has the channel call a built page. Without `php` on `PATH` they skip;
  `DUMBO_REQUIRE_PHP=1` makes them fail instead.
- **Raven's script under PowerShell.** `script_test.go` runs a rendered
  script against a stand-in for the HTTP channel and core: `pwsh` on `PATH`,
  or `RAVEN_PWSH` naming the command. Without either they skip;
  `RAVEN_REQUIRE_PWSH=1` makes them fail instead. CI runs them under
  PowerShell 7 on Linux and under Windows PowerShell 5.1 on Windows.
- **logos-vpn's installers.** `install.sh` runs under the runner's `sh` and
  `install.ps1` under PowerShell 7 (`LOGOS_VPN_PWSH`,
  `LOGOS_VPN_REQUIRE_PWSH`), and under Windows PowerShell 5.1 in CI. The
  end-to-end tests need no root: a second network stack plays the operator's
  machine.
- **factory-core over AMQP.** The integration test runs a factory against a
  scripted core on a real RabbitMQ, on a vhost no real core consumes:

  ```bash
  docker exec logos-rabbitmq rabbitmqctl add_vhost logos-it
  docker exec logos-rabbitmq rabbitmqctl set_permissions -p logos-it logos '.*' '.*' '.*'
  INTEGRATION_AMQP_URL=amqp://logos:<password>@localhost:5672/logos-it go test -run Integration ./...
  ```

  The password is core's `RABBITMQ_DEFAULT_PASS`.

### Core

| Part | Checks |
|---|---|
| Go | `make -s test`: the whole suite with `-race`, dummy values standing in for the settings `.env` lacks; `PKG=./pkg/…` for one package. Not a bare `go test`: `pkg/environment` refuses to load without its required settings. |
| Go, integration | `make -s test-integration`, with the stores running (`make infra` or `make services`): the repositories' queries against MongoDB, the token store's scripts against Redis, uploads against SeaweedFS's S3 gateway. They write to scratch databases (`itest_*`) and drop them. Without their `INTEGRATION_*` settings they skip, so `make test` and CI leave them out. |
| Web app, in `frontend/` | `npm run test:run` (vitest), `npm run lint` (ESLint: errors fail, warnings do not), `npm run build` (`tsc -b && vite build`: the typecheck too), then `npm run budget`. |
| hocuspocus, in `hocuspocus/` | `npm run typecheck`, `npm test`. |

`npm run budget` fails when the first paint's critical path, the entry and
every module `index.html` preloads, grows past the budgets in
`frontend/scripts/check-bundle-budget.mjs`. A budget may be raised, with the
reason in the commit message.

Run vitest apart from the Go suites, after them: beside the race-enabled Go
tests it times out.

## What CI runs

| Repository | Workflow | On | Runs |
|---|---|---|---|
| `logos-golang-protocol`, `logos-golang-module-core`, `logos-golang-channel-core`, `logos-golang-factory-core`, `logos-http-channel`, `logos-tcp-channel`, `logos-ssh` | CI (`ci.yml`) | pushes to `main`, `v*` tags, pull requests | `go test ./...`; golangci-lint v2.13.2. The protocol's also its 32-bit builds. |
| `logos-dumbo` | CI (`ci.yml`) | the same | The same, with PHP required (`DUMBO_REQUIRE_PHP=1`). |
| `logos-raven` | CI (`ci.yml`) | the same | The same, with PowerShell required, and a Windows job under Windows PowerShell 5.1. |
| `logos-vpn` | CI (`ci.yml`) | the same | `go test -race ./...`, the installers' tests under Windows PowerShell 5.1, lint for Linux, macOS and Windows, and `make dist` (not on tags). |
| `logos-http-channel`, `logos-tcp-channel`, `logos-dumbo`, `logos-ssh`, `logos-raven` | Docker Image (`docker-image.yml`) | `v*` tags | Builds and pushes the image, `linux/amd64` and `linux/arm64`. |
| `logos-vpn` | Release (`release.yml`) | `v*` tags | `make dist`, `SHA256SUMS`, and a GitHub release with the binaries and the installers. |
| `logos-bob-factory` | none | | Its checks run locally, and in a release. |
| `logos-core` | Core CI (`ci-core.yml`) | pushes to `main` and pull requests that touch `core/` | `go mod tidy -diff`, `go build ./...`, `go test -race -count=1 ./...`, golangci-lint v2.13.2 with `core/.golangci.yml`. |
| `logos-core` | Frontend CI (`ci-frontend.yml`) | the same, for `frontend/` | vitest, ESLint, the build and the bundle budget. |
| `logos-core` | Publish Core Image, Publish Frontend Image, Publish Hocuspocus Image, Publish nginx Image, Publish Helm Chart | pushes to `main` and pull requests that touch their part (core's image also on `frontend/`: it embeds the HTML export viewer) | Builds each image or the chart, and pushes it but for a pull request. Hocuspocus's typecheck and tests, nginx's configuration check, and the chart's lint and template come first and stop their own publish. |
| `logos-docs` | Deploy Docs (`deploy-docs.yml`) | pushes to `main` | `npm run check:diagrams`, `npm run build`, `npm run check:links`, then the deploy to GitHub Pages. |

**What gates what.** The CI workflows are the checks; the publish workflows
do not wait for them. A push to `main` publishes core's images even when Core
CI fails on it, and a tag publishes a module's image even when its CI fails:
the checks come before the push and the tag.

**`GOPRIVATE`.** Every workflow that builds Go and every Dockerfile sets
`GOPRIVATE=github.com/logoscore/*`: the go command fetches Logos modules
straight from GitHub, not through `proxy.golang.org`, so a tag builds the
moment it is pushed, and `go.sum` still checks what is fetched. The Alpine
build stages install `git` for it. Set the same locally
(`go env -w GOPRIVATE='github.com/logoscore/*'`) to take a new tag at once.

## What a release checks

Before a repository is tagged, with its dev wiring dropped and the round's
tags in its `go.mod` ([Releasing](../changing-the-protocol/#releasing)):

- in every Go module it holds, BOB's minion included: `go build ./...`,
  `go vet ./...`, `go test -race -count=1 ./...` (the race detector, never a
  cached result), and
  `golangci-lint run --max-issues-per-linter 0 --max-same-issues 0 ./...`,
  which must end at exactly `0 issues.`;
- the protocol's 32-bit builds, and BOB's minion's `GOARCH=386 go vet ./...`;
- core: `make -s test` and core's lint, and when the web app changed, its
  build and budget, ESLint, and vitest after the Go tests;
- for Raven and logos-vpn, whose Windows PowerShell 5.1 jobs run only on
  GitHub: `main` pushed and its CI passed, before the tag.

CI runs most Go suites without the race detector, and BOB has no CI: the
release is where those run.
