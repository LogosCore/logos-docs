---
title: "Development Stack"
---

The development stack is core's Docker Compose project: core and the web app
run from the checkout and reload on edits, behind the same nginx front
production runs. Each module is a Compose project of its own beside it, on
core's network.

## Prerequisites

| Tool | Version | For |
|---|---|---|
| Git, GNU Make | | the checkouts; core's `Makefile` |
| Docker with Compose v2 | | every stack. Core's `Makefile` calls `docker-compose`, the module repositories `docker compose`: both commands must work |
| Go | 1.25.7 | every Go repository: each `go.mod` says `go 1.25.7`, CI installs that version, the images build on `golang:1.25` |
| Node.js and npm | 22 | core's web app and hocuspocus, whose CI and images run Node 22; the docs too (their deploy runs Node 20, and Astro takes either) |
| golangci-lint | v2.13.2 | every Go repository: the version CI pins |
| PHP | | Dumbo's page tests, which skip without `php` on `PATH` |
| PowerShell 7 (`pwsh`) | | Raven's script tests and logos-vpn's installer tests, which skip without it |

A newer Go builds the repositories too, but their dependencies stay on
versions that build with Go 1.25 (logos-ssh's and logos-vpn's `CLAUDE.md`
name the last ones that do), and core's GraphQL code is generated with core's
Go ([Pitfalls](#pitfalls)).

Clone every repository into one folder, each under its own name. The dev
wiring for unreleased code finds a checkout by a relative path
(`../logos-golang-protocol`: [Changing the
Protocol](../changing-the-protocol/#working-against-an-unreleased-protocol)),
and Compose names core's network after its folder: `logos-core_logos`.

## Core's first run

```bash
cd logos-core
cp .env.example .env
(cd frontend && npm ci)
make services
```

- **`.env` first.** The `Makefile` includes it, so every target fails
  without it. `.env.example` has a value for every setting the stack needs;
  its `changeme_…` secrets are for a developer's machine alone. Its `localhost` values
  (`MONGO_URI`, `REDIS_HOST`, `SEAWEEDFS_S3_ENDPOINT`, …) are for tools run
  on the host (`make test`, `mongosh`): `docker-compose.yml` gives the
  containers the names inside the network. Compose stops without
  `OPERATIONAL_PORTS`, which the example sets.
- **`npm ci` in `frontend/`, once.** The web app's dev container runs Vite
  from the checkout's `frontend/`, its `node_modules` included, and installs
  nothing itself.
- **`make services`** starts the `development` profile, building its images
  the first time: RabbitMQ, MongoDB, Redis and SeaweedFS; `core-dev`, core
  under air, which rebuilds and restarts it when a Go file changes; `frontend-dev`,
  Vite; hocuspocus; and nginx, the `logos-nginx` image built from
  `deploy/nginx/`.

Then open <https://localhost:8443/>, the browser's way in; port 8080 serves
the same routes over plain HTTP, for scripts and clients that do not trust
the certificate. That certificate is the self-signed one committed in
`deploy/nginx/dev-certs/`: the browser warns about it once. While there is no account at all, the web
app opens its Enroll page, and the account it creates is the first admin.
The same through the API:

```bash
curl -s http://localhost:8080/api/v1/enroll \
  -H 'Content-Type: application/json' \
  -d '{"username": "admin", "password": "…"}'
```

`POST /api/v1/enroll` answers 409 once any account exists.

### URLs and ports

| Service | From the host | Inside the network |
|---|---|---|
| nginx: the web app, the APIs, the modules' WebSockets | <http://localhost:8080> (plain HTTP, the same routes), <https://localhost:8443> (TLS, HTTP/2) | `logos-nginx`, 80 and 443 |
| core (`core-dev`) | <http://localhost:8002> on `127.0.0.1`, for modules run on the host; browsers go through nginx | `http://logos-core-dev:8002` |
| the web app's Vite server (`frontend-dev`) | not published: through nginx | `logos-frontend-dev:5173` |
| hocuspocus | not published: through nginx | `logos-hocuspocus:1234` |
| RabbitMQ | `localhost:5672`; its management UI <http://localhost:15672> | `logos-rabbitmq:5672` |
| MongoDB | `localhost:27018` | `logos-mongodb:27017` |
| Redis | `localhost:6379` | `logos-redis:6379` |
| SeaweedFS's S3 gateway | <http://localhost:8333> | `logos-seaweedfs-s3:8333` |
| core's operational ports (tunnels' fronts) | `OPERATIONAL_PORTS` on `127.0.0.1`, TCP and UDP; `OPERATIONAL_PUBLISH` names another address of the host | |
| Keycloak (`make sso`) | <http://keycloak.localhost:8180> | `keycloak.localhost:8180` |

nginx routes `/api/` to core; core's own 8002 is published on the host's
loopback alone, so a module run there reaches core at its default address.

### Make targets

Run from the root of `logos-core`; `make help` lists them all.

| Target | Does |
|---|---|
| `make services` | Starts the dev stack (`--profile development`). |
| `make services-stop` | Stops it. |
| `make services-reset` | Stops it and deletes its volumes: every store's data. |
| `make services-rebuild` | Rebuilds the dev images and restarts the stack: after `package.json`, `go.mod`, a Dockerfile or `core/vpn-client.version` changed (core-dev's image holds logos-vpn's binaries). |
| `make infra`, `make infra-stop`, `make infra-reset` | The stores alone: RabbitMQ, MongoDB, Redis, SeaweedFS. |
| `make -s test` | Core's Go tests with the race detector; `PKG=./pkg/mcp/...` for one package ([Testing and CI](../testing-and-ci/)). |
| `make -s test-integration` | Core's integration tests, against the running MongoDB, Redis and SeaweedFS. |
| `make gqlgen` | Regenerates core's GraphQL code from `core/pkg/graphql/schema/schema.graphql`. |
| `make gqlcodegen` | Regenerates the web app's GraphQL types. |
| `make swag` | Regenerates the OpenAPI documentation. |
| `make viewer` | Builds the wiki's HTML export viewer, which the core binary embeds; without it, an HTML export fails and nothing else does. |
| `make frontend` | Runs Vite on the host. |
| `make sso`, `make sso-stop` | The dev Keycloak (profile `sso`); `OIDC_ENABLED=true` in `.env` signs in through it. Its users are in `deploy/keycloak/logos-realm.json`. |
| `make seaweedfs-reset` | Clears SeaweedFS's volumes alone, keeping the other stores. |

## Modules beside core

Each module repository has a `docker-compose.yml` of its own that joins
core's network, `logos-core_logos`, as an external one. With core's stack
up, in the module's folder, put `RABBITMQ_PASSWORD` in `.env` (core's
`RABBITMQ_DEFAULT_PASS`), then:

```bash
docker compose up -d --build
```

- **What it reaches.** Its containers reach core at
  `http://logos-core-dev:8002`, core itself rather than its front, and
  RabbitMQ at `logos-rabbitmq:5672` as `logos`: the compose file's
  defaults. Set `RABBITMQ_USER` too when core's `RABBITMQ_DEFAULT_USER` is
  not `logos`.
- **What it publishes.** The HTTP channel on 8090 (`HTTP_CHANNEL_PORT`);
  the TCP channel on 4790 and 4791, for minions that dial it; Dumbo's
  `dumbo-www`, a PHP server for trying pages put in `./www`, on 8095. The
  TCP and SSH channels reach the host as `host.docker.internal`: a minion
  listening there, or an SSH server.
- **What it needs.** Raven's minions check in through the HTTP channel:
  start that first.
- **`.env` is the compose file's too.** A core URL or broker host set there
  overrides the compose file's, which reach core inside the network, and
  the container would look for core and RabbitMQ in itself. For the stack
  keep the RabbitMQ password alone in it: the HTTP channel's `.env.example`
  sets only that, its other settings commented out.
- **On the host instead**, with `go run`, a module's defaults reach the dev
  stack: core at `http://localhost:8002` (core-dev's port, published on the
  host's loopback) and RabbitMQ at `localhost:5672` as `logos`. Set
  `RABBITMQ_PASSWORD` (core's `RABBITMQ_DEFAULT_PASS`): it has no default,
  and a module does not start without it. The HTTP channel also needs a
  `LISTEN_ADDR` other than `:8080`, which nginx has.

A module registers with core when it starts. Its README has the rest of its
settings. A module built against an unreleased protocol or SDK runs a binary
built on the host ([Changing the
Protocol](../changing-the-protocol/#working-against-an-unreleased-protocol)).

## Checking health

- **Core.** `curl -s http://localhost:8080/api/v1/status` answers 200 with
  JSON (`enrolled`, `local_login_enabled`, `oidc`) when core runs and reads
  MongoDB. A 502 from nginx means core-dev is not serving: its build failed,
  or air is building. `docker logs logos-core-dev` shows the build's
  output.
- **Modules.** The web app's Modules page (`/modules`) lists every
  registered instance and its state (dead, blocked). A
  module missing from it did not register: its log (`docker logs <its
  container>`) says why, usually RabbitMQ's credentials or core's URL.
- **Queues.** RabbitMQ's management UI shows each instance's queue,
  `logos.<type>.rpc.<instance>` ([AMQP Routing
  Conventions](../../contracts/amqp-conventions/)).

## Pitfalls

- **air watches `core/` alone.** core-dev rebuilds when a Go file under
  `core/` changes, not when a dependency mounted into the container does (a
  protocol checkout). After changing one, `docker restart logos-core-dev`:
  it builds again as it starts. A mount added or removed (a
  `docker-compose.override.yml`) needs the container recreated:
  `docker compose --profile development up -d core-dev`.
- **GraphQL code with core's Go.** `make gqlgen` runs
  `go generate ./pkg/graphql/...` in `core/` with the host's Go. Core is a
  Go 1.25 module, and core-dev runs Go 1.25 over the checkout: when the
  host's Go is another version, generate in the container instead. It runs
  as root, so give the files back in the same step:

  ```bash
  docker exec logos-core-dev sh -c "cd /app && go generate ./pkg/graphql/... && chown -R $(id -u):$(id -g) pkg/graphql"
  ```

  Then `make gqlcodegen` for the web app's types, on the host.
- **`make -s test`, not `make test`.** Make prints each command it runs,
  and the test targets' commands carry values from `.env`, passwords
  included: `-s` keeps them off the terminal and out of logs. The same for
  `make -s test-integration`.
- **A module's `.env`** feeds its compose file: host values in it break the
  container ([above](#modules-beside-core)).
