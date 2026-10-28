---
title: "Architecture"
---

Logos is a core server and the modules around it. Operators work in core's web
app or through its APIs, minions reach Logos through channel modules, and
factory modules build the minions. This page maps the parts and how they talk,
and separates what is built from what is still a plan.

## High-Level Components

- **Core Server** (`logos-core`): the control plane. It holds operations and
  their members, authentication and roles, the module registry and its
  lifecycle, module management and the live log tail, channel endpoints, minion
  builds and the minions they create, and the data-plane endpoint that channels
  relay minion traffic to.
- **Operator UI and API clients**: the web app (React) works over core's
  GraphQL and REST APIs. AI agents reach core through its MCP endpoint
  (`/api/v1/mcp`).
- **Modules**: separate processes, each a registered instance of a module type,
  built on the Go SDKs. See [Module Types](../module-types/).
  - **Channel modules** carry minion traffic between minions and core. The
    reference channel is `logos-http-channel`: HTTP and WebSocket, on any path.
  - **Factory modules** build minions. The reference factory is BOB
    (`logos-bob-factory`), which builds dummy minions.
- **Message bus (RabbitMQ)**: the control plane between core and the modules.
- **MongoDB**: core's persistence.
- **Redis**: login sessions, caches, and de-duplication of minion messages.
- **SeaweedFS**: object storage over the S3 API, for wiki files, build files
  and build artifacts.

[Core Infrastructure](../core-infrastructure/) has the services in detail.

## Communication Ownership Model

- The logical conversation is **minion ↔ core Server**.
- A channel module is only a transport relay between minion and core Server.
- Channel modules deliver canonical envelopes containing opaque encrypted blobs plus minimal routing metadata (`id`).
- Channel modules are not protocol peers for minion business logic and must stay plaintext-blind.
- How a channel module receives traffic from its transport and extracts the
  canonical fields is the channel's implementation detail — core defines only
  the envelope contract.

## Communication Model

- Modules do not call each other: each talks to core only.
- **Data plane**: a channel relays each minion message to core over HTTP
  (`POST /api/channel/sync`) and gets core's answer in the same response. It
  carries `id` and `encrypted_data` and never decrypts. See
  [Channel ↔ Core: HTTP Sync](../contracts/channel-core-sync/).
- **Control plane** (RabbitMQ):
  - modules register, heartbeat and deregister on core's queue, `logos.core.rpc`;
  - core calls each instance on its own queue, `logos.<type>.rpc.<instance>`,
    for management, the live log tail and, on a factory, builds;
  - factories report build progress and results on core's queue;
  - log records stream on `logos.module.logs`, while an operator watches;
  - core publishes lifecycle events on `logos.events`.

  See the [Contracts Overview](../contracts/overview/).
- Messages are versioned [envelopes](../contracts/amqp-envelope/), and
  operations are idempotent by their own keys: a build's minion id, an action's
  invocation id, a configuration revision.
- Files take neither route: factories download build files from, and upload
  artifacts to, presigned object store URLs.

## Built and Planned

| Area | Today |
|---|---|
| Module registry | Built: registration, heartbeats, dead instances; operators block, unblock and delete instances. |
| [Module management](../contracts/module-management/) | Built (prototype): configuration, actions, status values, change history. |
| [Live log tail](../contracts/module-logs/) | Built (prototype): streamed to the operator's browser, never stored. |
| [Channel endpoints](../contracts/minion-connection/) | Built: an operation's saved connection settings, with export and import. |
| [Minion builds](../contracts/minion-build/) | Built: build schemas, builds offered to factory instances, progress, artifacts checked, the minion recorded. |
| Data plane | Built: the sync endpoint with a registration gate and de-duplication. Core answers every message with an empty reply. |
| Payload crypto | Planned: core holds the minion keys, decrypts inbound and encrypts outbound. No contract yet. |
| Tasking | Planned: what core sends a minion, and how it maps to the commands a factory builds in (the factory command contract). |
| Observability | Planned: central audit logging and tracing. Core publishes lifecycle events that nothing consumes yet. |

## Deployment Shape

- Docker Compose runs the stack (`logos-core/docker-compose.yml`): core, the
  web app, the wiki collaboration server (hocuspocus), nginx, RabbitMQ,
  MongoDB, Redis and SeaweedFS, with Keycloak for single sign-on under the
  `sso` profile.
- Each module is a Compose project of its own. It joins core's network
  (`logos-core_logos`) and registers with core when it starts.
- nginx is the operators' entrypoint, terminates TLS, and routes `/api/` to
  core.
- A Helm chart (`logos-core/deploy/helm/logos`) deploys core to Kubernetes. It
  does not deploy RabbitMQ yet, which core needs to start.

## Trust Boundaries

- **Minion → channel**: the internet side. Each channel owns its listener.
- **Channel → core** (`/api/channel/sync`): no authentication today. Core
  admits only registered, unblocked instances, by the instance id the channel
  asserts.
- **Operator → core**: through nginx. JWT sessions (local login, or single
  sign-on through OIDC), CSRF protection on every change, and roles.
- **Core and modules → RabbitMQ**: one broker account, shared today.
- **Core → MongoDB, Redis, SeaweedFS**: core only. A factory reaches SeaweedFS
  through presigned URLs, for one build's objects.

## Baseline Security Controls

Built:

- Roles for every operator action: an account's own role, and its role in each
  operation (viewer, operator or admin).
- Channels are blind relays: they carry `id` and `encrypted_data` only.
- The sync registration gate, and de-duplication of replayed messages.
- Factories hold no storage credentials, only one build's URLs.
- A record of what operators did to modules: configuration changes and action
  invocations.

Planned:

- Application-layer encryption of minion payloads end to end
  (`minion` ↔ `core Server`), with the keys held by core only.
- Encrypted control-plane transport (AMQP over TLS), and per-module broker
  accounts with queue permissions.
- Central audit logging and tracing.

## Pending Decisions

1. ~~RabbitMQ exchange/queue naming conventions and routing-key strategy.~~  Resolved — see [AMQP Routing Conventions](../contracts/amqp-conventions/).
2. ~~Message contract format and versioning policy.~~  Resolved — see [AMQP Message Envelope](../contracts/amqp-envelope/).
3. ~~Database engine and schema partitioning strategy.~~ Resolved — see [Core Infrastructure](../core-infrastructure/) (MongoDB).
4. Module packaging and lifecycle policy (enable/disable/version compatibility). Partly settled: operators block, unblock and delete instances ([Module Lifecycle](../contracts/module-lifecycle/)), and build and connection schemas carry versions. Packaging is open.
5. The payload crypto contract: the suites, their key material, where core encrypts and decrypts.
6. The factory command contract: tasks, how they reach the commands a minion was built with, and their results.
