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
  carries the build id and the ciphertext, as the raw body, and never
  decrypts. See
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
  operations are idempotent by their own keys: a build id, an action's
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
| Data plane | Built: the [sync endpoint](../contracts/channel-core-sync/) (the ciphertext as the raw body) with a registration gate, a size limit and de-duplication; core answers each message with a sealed reply, or 204 when it has nothing. |
| Payload crypto | Built: `aes-256-cbc-hmac-sha256`. Core generates each build's keys, gives each minion process keys of its own when it stages, and seals and opens every frame ([Wire Format](../contracts/minion-messages/wire-format/)). |
| Tasking | Built: sessions, tasks and results, listings into the file browser, and file transfers both ways ([Minion Messages](../contracts/minion-messages/), [Task Results and Actions](../contracts/task-results-and-actions/)). |
| Observability | Planned: central audit logging and tracing. Core publishes lifecycle events that nothing consumes yet. |
| [Connection kinds](../module-types/#connection-kinds) | Built: `reverse-call`, and `reverse-persistent` over a connection socket per minion connection, core pushing tasks as they are queued ([Connections](../contracts/channel-core-connections/)). `bind-call` over the control link, with targets (the Dumbo channel and factory). A draft: `bind-persistent`. |

## Deployment Shape

- Docker Compose runs the stack (`logos-core/docker-compose.yml`): core, the
  web app, the wiki collaboration server (hocuspocus), nginx, RabbitMQ,
  MongoDB, Redis and SeaweedFS, with Keycloak for single sign-on under the
  `sso` profile.
- Each module is a Compose project of its own. It joins core's network
  (`logos-core_logos`) and registers with core when it starts.
- nginx is the operators' entrypoint, terminates TLS, and routes `/api/` to
  core.
- A Helm chart (`logos-core/deploy/helm/logos`) deploys core to Kubernetes,
  RabbitMQ included. Modules are not in it yet.
- Core runs as **one instance**: see below.

## One core instance

Core runs as a single process. Its data is shared (MongoDB, Redis, the
object store), so most of it would work from several, but not all of it:

- **The event bus is in the process.** It feeds the web app's live views
  (GraphQL subscriptions). With two instances, a change one handles (a
  minion's result, a new session) never reaches browsers connected to the
  other.
- **Background jobs run in every process**: the lifecycle reaper, the build
  scheduler, the sweeps of minion files and streams, the wiki's auto-backup.
  Only the build scheduler is guarded against a second instance (a lease on
  each build it offers).
- **Open connections belong to a process.** A minion's persistent connection,
  once channels keep them open to core, is held by one instance, and only
  that one can send on it.

So the Helm chart runs one core replica. A rollout runs the new pod beside
the old one for a few seconds; that is harmless. A deploy or a crash leaves
core unreachable for a moment, which minions take as a failed check-in and
retry.

Scaling out is not built, and three rules keep it a contained change when it
is:

1. **Mongo and Redis decide.** A process may cache what it reads, never hold
   the only copy of something another instance would need.
2. **Every push to a minion connection goes through one interface** (send to
   a session). With one instance it finds the connection in memory; with
   several it learns which instance holds it and hands the message over, and
   no caller changes.
3. **A periodic job is safe to run twice at once**: a conditional update, or
   a lease like the build scheduler's.

Adding instances then means: an event bus shared between them (a RabbitMQ
fanout exchange, one queue per instance, behind the bus interface core
already has), handing pushes to the instance that holds a connection, and
guards on the background jobs that lack them.

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
- Channels are blind relays: they carry the build id and its ciphertext only.
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
5. ~~The payload crypto contract.~~ Resolved — see [Wire Format](../contracts/minion-messages/wire-format/).
6. ~~The factory command contract.~~ Resolved — see [Minion Messages](../contracts/minion-messages/) and [Task Results and Actions](../contracts/task-results-and-actions/).
7. Several core instances: see [One core instance](#one-core-instance).
