---
title: "Glossary"
---

The terms these docs use, each with the page that explains it. Several words
mean more than one thing in Logos; their entries say which is which.

## Parts

- **Core**: The server (`logos-core`): operators work in its web app and APIs, and
  every module talks to it. It holds minions' keys and is their real peer.
  [Core Responsibilities](../core-responsibilities/).
- **Module**: A separate process that registers with core and does one job: a channel
  or a factory. Each runs as one or more **instances**, each with an
  instance id unique across all modules. [Module Types](../module-types/),
  [Module Lifecycle](../contracts/module-lifecycle/).
- **Channel**: A module that carries minions' traffic between minions and core over a
  transport (HTTP, TCP, SSH), without reading it.
  [Module Types](../module-types/#1-channel-modules).
- **Channel kind**: A channel module by name (`module_name`, such as `http`): all its
  instances. A build names the channel kinds its minion speaks. Not to be
  confused with a connection kind.
- **Factory**: A module that builds minions for the targets it declares.
  [Module Types](../module-types/#2-factory-modules).
- **Minion**: What a factory builds and core sends tasks to: a program, a script or a
  page that reaches core through a channel, says hello, and runs the tasks it
  is given. An [agentless channel](../contracts/agentless-channels/) acts as
  the minion itself. [Minion Messages](../contracts/minion-messages/).
- **Operator**: A person working in core's web app or APIs, with a role in each operation
  (viewer, operator or admin).
- **Operation**: (1) A shared workspace in core: its members and their roles, and its
  endpoints, builds, minions and sessions. (2) On the control plane, the name
  of an RPC (`module.register`, `factory.build`):
  [AMQP Routing](../contracts/amqp-conventions/).

## Builds

- **Build schema**: What a factory declares it can build: targets, build parameters,
  channels, commands. [Minion Build](../contracts/minion-build/).
- **Target**: (1) What a factory builds, by id (BOB's `linux-elf`, `windows-exe`): the
  build schema's targets. (2) For a `bind` connection, where core reaches a
  minion: an address an operator gives, by the channel's target fields.
  [Connections](../contracts/channel-core-connections/).
- **Build**: One request to a factory for one minion: a target, a platform, values,
  commands and connections. A successful one records the minion.
- **Artifact**: What a build produces (a binary, a script, a page), uploaded to core and
  downloaded by an operator.
- **Endpoint**: An operation's saved connection settings for a channel kind and connection
  kind, reused when building minions.
  [Minion Connection Schema](../contracts/minion-connection/).
- **Minion config**: A build's settings as numbered CBOR, which core makes for a factory that
  asks for it. [Minion Build](../contracts/minion-build/#the-minion-config).

## Connections

- **Connection**: One of a build's ways to reach core: a channel kind, a connection kind and
  their settings. A minion may have several and move between them.
- **Connection kind**: Who dials and how long a connection lasts: `reverse-call`,
  `reverse-persistent`, `bind-call`, `bind-persistent`.
  [Module Types](../module-types/#connection-kinds).
- **Connection schema**: What a channel declares a minion needs to reach it, per connection kind.
  [Minion Connection Schema](../contracts/minion-connection/).
- **Data plane**: The paths minion traffic takes between a channel and core: the sync call,
  connection sockets and the control link.
  [Contracts Overview](../contracts/overview/#how-modules-reach-core).
- **Control plane**: Everything between core and modules that is not minion traffic: RabbitMQ
  for lifecycle, management, logs and builds.
- **Sync call**: `POST /api/channel/sync`: one minion message per request, core's reply in
  the response. [HTTP Sync](../contracts/channel-core-sync/).
- **Control link**: A channel instance's WebSocket to core, over which core calls `bind-call`
  minions and opens `bind-persistent` ones.
  [Connections](../contracts/channel-core-connections/).
- **Connection socket**: A WebSocket from a channel to core for one minion connection of a
  persistent kind. [Connections](../contracts/channel-core-connections/).
- **Factory link**: A factory instance's WebSocket to core, over which core asks it to
  translate its minions' codec. [Codecs](../contracts/minion-messages/codecs/).
- **Agentless channel**: A channel that acts as the minion itself (the SSH channel over an SSH
  login), so nothing is installed on the far side.
  [Agentless Channels](../contracts/agentless-channels/).
- **Delegate**: A minion serving a channel's transport for other minions while one of its
  tasks runs. [Delegation](../contracts/minion-messages/delegation/).

## Messages

- **Sealed frame**: A minion message as it travels: encrypted and authenticated with the keys
  of the id it is sent under. [Wire Format](../contracts/minion-messages/wire-format/).
- **Suite**: The payload crypto: core's `aes-256-cbc-hmac-sha256`, or a factory's own.
- **Envelope**: (1) How a minion message is written in plaintext: CBOR (the default), JSON,
  or a factory's own ([Codecs](../contracts/minion-messages/codecs/)).
  (2) The control plane's AMQP message wrapper
  ([AMQP Envelope](../contracts/amqp-envelope/)).
- **Codec**: A build's envelope and suite together.
- **Item**: One unit in a minion message (`hello`, `get_tasks`, `task`, `result`, …),
  each with a number. [Wire Format](../contracts/minion-messages/wire-format/#registry).
- **Staging**: A new minion process's first exchange, under the build id: core gives it
  keys of its own and a **temporary id**, under which it says hello.
  [Sessions](../contracts/minion-messages/sessions/).
- **Session**: (1) A minion process's life in core, from its hello: its tasks, presence
  and connections. (2) An operator's login session.
  [Sessions](../contracts/minion-messages/sessions/).
- **Task, command, result**: An operator's instruction to a session's minion, for one of the commands
  its build has (named on the wire by its number, `op`), and what the minion
  sends back. [Tasks and Results](../contracts/minion-messages/tasks-and-results/).

## Tunnels

- **Tunnel**: Streams a minion opens from its host, carried in its messages, for a
  front on core. [Tunnels](../contracts/minion-messages/tunnels/).
- **Front**: (1) What core puts in front of a tunnel on an operational port: SOCKS, an
  HTTP proxy, a forward, a terminal; or an operator's VPN client
  ([VPN Front](../contracts/vpn-front/)). (2) Core's own front: the nginx in
  front of core ([Core Infrastructure](../core-infrastructure/#nginx--cores-front)).
- **Operational port**: A port on core where a tunnel's front listens.
