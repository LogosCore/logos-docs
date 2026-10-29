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
channel: a channel waits for minions to reach it, a dialer **opens the
connection to a minion**, when core asks it to. It is a separate module type,
`dialer`, next to `channel` and `factory`.

What the connection is depends on the dialer:

| Dialer | The connection | Who starts exchanges |
|---|---|---|
| HTTP, to a page on a web server (a PHP script, say) | one call: a request and its response, no state kept | core only: the minion just answers |
| SSH, or TCP to a listening minion | stays open while it is useful, or one call per command (SSH) | either side: the minion checks in as through a channel, and core sends when it has something |

### How it would work

1. Core decides to reach the minion: an operator queued a task for it, a
   schedule is due, or an operator asks now. It asks a dialer over the
   control plane (an RPC like management's, e.g. `dialer.call`).
2. The dialer opens the connection.
3. Over it, exchanges go both ways, in the same message formats as through a
   channel ([Minion Messages](../contracts/minion-messages/)):
   - **the minion starts** (when it can): staging, `hello`, check-ins with
     `get_tasks` and results. The dialer relays them to core like a channel,
     with the [sync call](../contracts/channel-core-sync/);
   - **core starts**: it hands the dialer a sealed core message (tasks,
     `cancel`), the dialer delivers it, and returns the minion's sealed
     answer.
4. The dialer closes the connection after the call, or keeps it, as its kind
   of connection allows.

Each message carries an `id` when it starts an exchange and `re` when it
answers one, so exchanges started from both sides on one connection never
mix. Like a channel, a dialer never decrypts.

**Sessions.** A minion that can start exchanges stages like any other. A
minion that only answers cannot, so core creates its session ahead of time,
when an operator registers the minion's address: a **premade session** under
the build's own keys.

**Replays.** Core does not require a minion to protect itself from replays
of exchanges core started: a captured core message sent to it again would run
its tasks again. A minion implementation may guard against that its own way,
for instance by remembering recent message ids.

### Modes: `call` and `connect`

A dialer declares at registration which **modes** it supports:

| Mode | What it is | Example |
|---|---|---|
| `call` | one call per exchange: the dialer connects, delivers, takes the answer, disconnects | HTTP to a PHP page |
| `connect` | a lasting connection that an operator opens for a session and closes after the work | a TCP connection to a listening minion |
| both | either, as below | SSH: a single command, or an open connection |

(The names avoid "session", which already means the minion's crypto session.)

**The minion has a say too.** A PHP page answers single calls whatever the
dialer could do. So a factory declares per target which modes its minions
support, the way targets declare their platforms and channels, and the modes
a session can use are those **both** the dialer and the build's minion
support.

**What an operator sees:**

- **`call` only**: every command is a call. There is nothing to open or close.
- **`connect` only**: the session has its own menu to **open a connection**.
  Commands work only while one is open; the operator closes it after the work.
- **Both**: commands work without a connection, each as a call, and the
  operator can still open one. While a connection is open, commands go over
  it; while none is, each command is a call. The operator never picks per
  command.

**A connection's lifecycle:**

- It belongs to the **session**, not to the operator who opened it: others
  with access to the operation see that it is open and can use it.
- Besides the operator, an idle timeout, the network or the minion dropping
  it, or the dialer stopping or draining close it. The UI shows its state;
  core never assumes a connection outlives its dialer.
- With `connect` only, commands are disabled while no connection is open.
  Tasks created anyway (by the API, or queued just before a connection
  dropped) wait, and go out when the next connection opens.
- The minion checks in only while a connection is open. Between connections
  core shows it as unreachable on purpose, not as lost.

**The registration field.** Like `connection` for channels and `build` for
factories, a dialer adds a top-level field to its registration, e.g.
`dial: {modes: ["call", "connect"], target: …}`, where `target` describes the
addresses it reaches (a URL; host and port) the way a channel's connection
schema describes its settings.

### To decide when it is designed

- **The premade session**: how core creates it, under which id, and how the
  minion's details (its `hello`) reach core when core starts the exchange.
- **The control-plane operation**: what core sends (the sealed message, the
  target, a deadline) and what the dialer answers (the minion's sealed
  message, or why the call failed).
- **Target addresses**: the `target` part of the registration field, and
  where operators enter them per minion.
- **Modes in the build schema**: how a factory's targets declare the modes
  their minions support.
- **Long tasks** on one-call connections: the minion answers within the call;
  a task that runs longer leaves its results for a later call.
- **When core calls**: on a new task, on a schedule, on demand, and what it
  does when a call fails.
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
