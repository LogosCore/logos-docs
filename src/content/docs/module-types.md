---
title: "Module Types"
---

Logos has two kinds of modules: **channels**, which carry minions' messages
to and from core, and **factories**, which build minions.

## 1) Channel Modules

Channel modules carry a minion's messages between the minion and core over a
transport: HTTP, WebSocket, SSH, DNS, whatever the channel speaks. A channel
never decrypts: what it carries is sealed, and core is the minion's real
peer. The one exception is an [agentless](../contracts/agentless-channels/)
channel, which acts as the minion itself.

### Responsibilities

- Carry minion messages over its transport, in the [connection
  kinds](#connection-kinds) it supports, and pass them to core and back
  without reading them.
- Take each sealed frame from its transport, with the id it was sent under
  (the build's, then the temporary id staging gives, then the session's): how
  is the channel's own.
- Register with core on startup via [Module Lifecycle](../contracts/module-lifecycle/),
  declaring its [minion connection schema](../contracts/minion-connection/): the
  settings a minion is given to reach it, which operators keep as endpoints and
  fill in for each connection of a build.
- Handle transport-specific concerns (polling cadence, retries, rate limits).

### Connection kinds

A minion's connection differs in two ways: **who dials**, and **how long it
lasts**.

| | One exchange per connection (`call`) | The connection stays open (`persistent`) |
|---|---|---|
| **The minion dials the channel** (`reverse`) | `reverse-call`: HTTP requests, polled | `reverse-persistent`: a WebSocket the minion keeps open |
| **The channel dials the minion** (`bind`) | `bind-call`: a request to a page on a web server (a PHP script) | `bind-persistent`: SSH, or TCP to a listening minion |

The names are the ones operators know from reverse and bind shells. They
decide who can start an exchange, and when core can reach the minion:

| Kind | Opened by | Who starts exchanges | Core can send |
|---|---|---|---|
| `reverse-call` | the minion | the minion; core only answers | when the minion next checks in |
| `reverse-persistent` | the minion | both | while the connection is open |
| `bind-call` | the channel, when core asks | core; the minion only answers | whenever core calls |
| `bind-persistent` | the channel, when core asks | both | while the connection is open, which core can ask for |

Built: `reverse-call`, `reverse-persistent` (the HTTP channel's
WebSocket, over a connection socket to core), `bind-call` (the Dumbo
channel calling PHP pages the Dumbo factory builds, over the control link),
and `bind-persistent` (the TCP channel dialing a BOB minion that listens,
opened over the control link, then a connection socket).

The [minion messages](../contracts/minion-messages/) are the same on every
kind; how each of their mechanics (staging, tasks, cancels, files, streams,
presence, replays) goes on each kind, and what a new mechanic needs to fit
all four, is [Mechanics by connection kind](../contracts/minion-messages/#mechanics-by-connection-kind).
A kind may also say how large a message it carries (`max_message`): core
and the minion keep within it.

### Channel ↔ core

A channel reaches core three ways:

| Path | One per | For |
|---|---|---|
| The [sync call](../contracts/channel-core-sync/) (built) | message | `reverse-call` |
| The **control link**, a WebSocket (built) | channel instance | `bind-call`, and opening `bind-persistent` |
| A **connection socket**, a WebSocket (built) | minion connection | `reverse-persistent`, `bind-persistent` |

The channel opens all of them: core never connects to a channel. The design,
with how `bind` minions are reached, how persistent connections live, how
channels and factories declare the kinds and how operators switch a
minion's connection, is [Channel ↔ Core: Connections](../contracts/channel-core-connections/).

### What core requires from a channel

Well-formed requests from an instance that is registered and not blocked:
sync calls, and the handshakes of its control link and connection sockets.
Core answers an unregistered, dead or blocked instance with 403. How a
channel receives traffic, what transport it uses, and how it takes a frame
from it is the channel's own. Core defines the
contracts in [Channel ↔ Core: HTTP Sync](../contracts/channel-core-sync/)
and [Channel ↔ Core: Connections](../contracts/channel-core-connections/).

### Examples

- HTTP(S) and WebSocket: `logos-http-channel`, the reference channel. It
  accepts any method on any path (`reverse-call`), and WebSocket connections
  whose binary frames are messages (`reverse-persistent`, over a connection
  socket to core). Its connection schema gives each kind its own fields.
- PHP pages: the Dumbo channel (`logos-dumbo`, with the Dumbo factory in one
  repo and image) calls the pages the factory builds (`bind-call`), over its
  control link to core.
- Listening minions: `logos-tcp-channel` dials a minion that listens on a
  TCP port, directly or through a proxy (`bind-persistent`), and relays its
  length-prefixed frames over a connection socket.
- SSH: `logos-ssh`, an [agentless](../contracts/agentless-channels/)
  channel that acts as the minion, with nothing installed on the server,
  and its factory.
- DNS or GitHub channels: possible, none built yet. A DNS channel would say
  a small `max_message` for its kinds.

### Notes

- Keep the transport apart from what the minion and core say: the channel
  relays frames, and core is the minion's peer.
- A channel never sees a minion's plaintext; an agentless one, acting as the
  minion, is the exception.
- [Writing a Channel](../guides/writing-a-channel/) walks through building one.

## 2) Factory Modules

Factory modules build minions. A factory decides what its minions are: the
targets it builds for, the build parameters, the channels its minions speak
and the commands they can be built with.

### Responsibilities

- Declare what can be built in a [build schema](../contracts/minion-build/)
  at registration: targets and their platforms, the build parameters, the
  channel kinds the minions speak and the [connection kinds](#connection-kinds)
  through each, per target, with the factory's own connection parameters for
  each kind, and the commands the minions can be built with.
- Build minions on core's request (`factory.build`): report the build's plan
  and progress, upload the artifact to the URL core gives, and report the
  result.
- Build in the commands the operator picked, and no others.
- Translate its minions' codec, their envelope or their suite, when they
  cannot speak core's ([Codecs](#codecs)).

### Examples

- BOB (`logos-bob-factory`), the reference factory: it compiles a Go minion
  for Linux and Windows (targets `linux-elf` and `windows-exe`) that speaks
  the HTTP and TCP channels' kinds, with shell, file, tunnel and delegation
  commands among others.
- Dumbo (`logos-dumbo`, the factory and its channel in one repo and image):
  PHP pages, `bind-call` minions core reaches through the Dumbo channel; a
  proof of concept with eight commands (hello, files, listings, walks).
- Raven (`logos-raven`): PowerShell scripts that check in through the HTTP
  channel (`reverse-call`) and do hello and echo; a test of
  [codecs](../contracts/minion-messages/codecs/#raven-the-test-factory): its
  minions speak PowerShell's CLIXML, which Raven translates for core, and its
  suite seals nothing.
- Go, .NET or Python factories: possible, none built yet.

### Codecs

A factory whose minions cannot speak core's codec, the CBOR envelope or the
`aes-256-cbc-hmac-sha256` suite, may translate either layer itself: its
build schema names its own (`<module_name>.<name>`), and core hands that
layer to the factory over a factory link, one call per message each way. A
factory that translates its suite makes that suite's keys too. Core also
offers a JSON envelope of its own, with no factory in the message's path.
The item model stays the protocol's: a codec changes how a message is
written, never what it says.

### Notes

- Declare the commands its minions can be built with (the build schema's
  `commands`); operators pick each build's, and the minion has those. A task
  names its command by number (`op`), and its params by theirs (`num`).
- Raise the build schema's `version` when values saved against the previous
  one would build something else ([Minion Build](../contracts/minion-build/)).
- [Writing a Factory](../guides/writing-a-factory/) walks through building one,
  and [Writing a Minion](../guides/writing-a-minion/) through what its minions
  implement.

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

- Minion payload crypto (`encrypt/decrypt/verify/sign`) belongs to core Logos services, or to the build's own factory when it translates its suite ([Codecs](../contracts/minion-messages/codecs/)).
- Channel modules must be plaintext-blind: they carry sealed frames and the ids they were sent under. An [agentless channel](../contracts/agentless-channels/), which acts as the minion, is the exception.

## Contracts

The contracts these modules implement are in the
[Contracts](../contracts/overview/) section, whose overview says which
modules implement each.

To build one, start with [Implementing a Module](../implementing-a-module/):
`logos-golang-module-core` for every module, with `logos-golang-channel-core`
for a channel and `logos-golang-factory-core` for a factory. Then
[Writing a Channel](../guides/writing-a-channel/), or
[Writing a Factory](../guides/writing-a-factory/) and
[Writing a Minion](../guides/writing-a-minion/).

Still open: giving a running minion a new connection (`add_connection`, a
draft on the [Connections](../contracts/channel-core-connections/) page), and
module packaging.
