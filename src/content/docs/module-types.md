---
title: "Module Types"
---

This page defines initial module categories in the Logos modular architecture.

## 1) Channel Modules

Channel modules provide transport paths between minions and the core Server platform.

### Responsibilities

- Accept inbound minion traffic from a specific transport/platform.
- Extract the build id and its ciphertext from the transport (channel-defined logic).
- Treat minion payload as opaque encrypted blob (no decrypt/inspect).
- Send them to core's sync endpoint (`POST /api/channel/sync`): the ciphertext as the raw body, the ids in headers.
- Relay core's reply (ciphertext, or nothing) back to the minion via the transport.
- Register with core on startup via [Module Lifecycle](../contracts/module-lifecycle/),
  declaring its [minion connection schema](../contracts/minion-connection/): the
  settings a minion is given to reach it, which operators keep as endpoints and
  fill in for each connection of a build.
- Handle transport-specific concerns (sessions, polling cadence, retries, rate limits).

### What core requires from a channel

A well-formed sync request from an instance that is
registered and not blocked — nothing more. Core answers an unregistered, dead or
blocked instance with 403. How a channel receives traffic, what transport
protocol it uses, and how it extracts the canonical fields is entirely the
channel's implementation detail. Core defines the envelope contract in
[Channel ↔ Core: HTTP Sync](../contracts/channel-core-sync/).

### Examples

- HTTP(S) and WebSocket: `logos-http-channel`, the reference channel. It
  accepts any method on any path, and WebSocket connections whose binary frames
  are messages.
- DNS or GitHub channels: possible, none built yet.

### Notes

- Keep transport logic isolated from business/tasking logic.
- Channel modules are blind to minion plaintext by design.
- Channel role is envelope delivery, not Logos semantics.
- The real protocol peer is core Server, not the channel module.
- Enforce per-channel authentication and abuse controls.
- Expose channel health and queue lag metrics.

## 2) Factory Modules

Factory modules build minions. They define minion families and lifecycle behavior.

### Responsibilities

Built:

- Declare what can be built in a [build schema](../contracts/minion-build/)
  at registration: targets and their platforms, the build parameters, the
  channel kinds the minions speak with the factory's own connection parameters
  for each, and the commands the minions can be built with.
- Build minions on core's request (`factory.build`): report the build's plan
  and progress, upload the artifact to the URL core gives, and report the
  result.
- Build in the commands the operator picked, and no others.

Planned, with the factory command contract:

- Preprocess operator/core commands into minion-specific wire format.
- Postprocess raw minion responses into structured events/results.
- Version the command contract per minion family.

### Examples

- BOB (`logos-bob-factory`), the reference factory: it builds dummy minions, a
  JSON description of what the minion would be built with.
- Go, .NET or Python factories: possible, none built yet.

### Optional Translator Hooks

:::note[Not built]
A design for the factory command contract: no factory implements hooks yet,
and core sends factories no minion traffic.
:::

By default, the preprocess/postprocess responsibilities above map directly
between the normalized Logos model and the minion wire format. A factory that
wants a **custom language for its minions** may optionally implement translator
hooks to insert its own intermediate representation:

- `translate_outbound` — convert a normalized Logos command intent into the
  factory's custom minion language before it is serialized to wire format.
- `translate_inbound` — convert a raw minion response in the factory's custom
  language back into the normalized Logos result schema.

Hooks are an implementation detail **owned entirely by the factory** — they are
not a separate module or deployable. Factories that need no custom language
simply omit them and rely on the default direct mapping.

Guidance for factories that implement them:

- Translator hooks run inside the factory, a core-side processing layer that
  operates on already-decrypted plaintext. They never cross the channel trust
  boundary and never touch payload crypto.
- Keep hooks deterministic and test-heavy.
- Make the mapping explicit; avoid hidden heuristic behavior in critical paths.
- Version the custom language alongside the factory's command contracts.

### Notes

- Keep factory-specific command grammar encapsulated.
- Version command contracts per factory.
- Declare the commands its minions can be built with (the build schema's
  `commands`); operators pick each build's, and the minion has those.

## 3) Dialer Modules (planned)

An idea for later, not designed or built. A **dialer** is the opposite of a
channel: a channel waits for minions to connect to it, a dialer connects to a
minion that **listens** (on a TCP port, a named pipe, …) when core asks it to.
It is a separate module type, `dialer`, next to `channel` and `factory`.

### How it would work

1. Core decides a listening minion should be contacted: an operator queued a
   task for it, a schedule is due, or an operator asks to connect now.
2. Core asks a dialer over the control plane (an RPC like management's,
   e.g. `dialer.connect`) to connect to the minion's address.
3. The dialer opens the connection. The minion sends the first message on it,
   as it does to a channel: `stage`, `hello`, or `get_tasks` with its results
   ([Minion Messages](../contracts/minion-messages/)).
4. The dialer relays it to core like a channel does, with the
   [sync call](../contracts/channel-core-sync/), and writes core's reply back.
   It keeps the connection for further check-ins, or closes it.

The messages between minion and core stay exactly as they are: core still
only answers a minion's request, and the dialer, like a channel, never
decrypts. What changes is who opens the connection, and that core decides
when.

### To decide when it is designed

- **The control-plane operation**: what core sends (the target, the build or
  session id for logs, a deadline) and what the dialer answers (connected or
  failed, and why).
- **Target addresses**: a listening minion has no channel endpoint to reach.
  A dialer declares what its targets look like (host and port, a pipe name),
  the way a channel declares its connection schema; operators enter them per
  minion, or core takes them from the minion's `hello` addresses.
- **When core asks**: on a new task, on a schedule, on demand, and what it
  does when a connection fails.
- **The pieces it would bring**: `module_type: "dialer"`, its RPC exchange
  `logos.dialer.rpc`, an SDK `logos-golang-dialer-core` beside channel-core
  and factory-core, and a "Dialers" section in these docs.

## Cross-Cutting Module Requirements

All module types should:

- Register with core on startup and heartbeat for liveness via the [Module Lifecycle](../contracts/module-lifecycle/) contract. A blocked instance is refused until an operator unblocks it; the SDK keeps asking, at its longest backoff.
- Declare what operators can manage on them in a [management manifest](../contracts/module-management/), and serve the [live log tail](../contracts/module-logs/).
- Send an icon at registration, shown with the module in the web app.
- Communicate through RabbitMQ channels using versioned message schemas.
- Include correlation IDs for traceability across services.
- Be independently deployable/replaceable in Docker Compose stacks.
- Emit structured logs and health signals.
- Support graceful shutdown and idempotent processing where possible.

Crypto boundary rules:

- Minion payload crypto (`encrypt/decrypt/verify/sign`) belongs to core Logos services.
- Channel modules must be plaintext-blind and process only routing metadata + encrypted blobs.

## Contracts

The wire-level contracts these modules use are specified in the
[Contracts](../contracts/overview/) section:

1. Base message envelope and versioning — [AMQP Message Envelope](../contracts/amqp-envelope/).
2. Exchange/queue naming convention — [AMQP Routing Conventions](../contracts/amqp-conventions/).
3. Data-plane envelope — [Channel ↔ Core: HTTP Sync](../contracts/channel-core-sync/).
4. Lifecycle — [Module Lifecycle](../contracts/module-lifecycle/).
5. Management — [Module Management](../contracts/module-management/) and the
   [live log tail](../contracts/module-logs/).
6. What minions are given to reach a channel — [Minion Connection Schema](../contracts/minion-connection/).
7. Builds — [Minion Build](../contracts/minion-build/).

For building a module against them, see [Implementing a Module](../implementing-a-module/):
`logos-golang-module-core` for every module, with `logos-golang-channel-core`
for a channel and `logos-golang-factory-core` for a factory.

Still open: the factory command contract, and module packaging/lifecycle policy.
