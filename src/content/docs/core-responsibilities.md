---
title: "Core Responsibilities"
---

`logos-core` is the control plane: the server operators work in and every
module talks to. This page lists what core does, one area at a time, each with
the page that holds its contract. [Architecture](../architecture/#built-and-planned)
says what is built and what is planned.

## 1) Module Registry and Lifecycle

- Register module instances, keep them alive on heartbeats, and declare an
  instance dead when its heartbeats stop.
- Keep what each instance declared at registration: its management manifest,
  its icon, and for a channel its minion connection schema, for a factory its
  build schema.
- Let operators block an instance (core refuses its traffic and tells it so),
  unblock it, and delete what core keeps of one.
- Publish lifecycle events (`logos.events`): registered, deregistered, declared
  dead, blocked, unblocked, deleted.

See [Module Lifecycle](../contracts/module-lifecycle/).

## 2) Module Management

- Keep each managed instance's desired configuration, push it at registration
  and on every change, and repair drift that heartbeats reveal.
- Invoke the actions modules declare, read their status values, and keep the
  history of configuration changes and invocations.
- Relay a module's live log tail to the operator who watches it, storing
  nothing.

See [Module Management](../contracts/module-management/) and
[Module Logs](../contracts/module-logs/).

## 3) Channel Endpoints and Minion Builds

- Keep each operation's channel endpoints: connection settings by a channel's
  connection schema, reused when building minions.
- Run minion builds: validate a build against the factory's build schema, queue
  it, offer it to a live factory instance, follow its plan and progress, check
  the artifact it uploads, and record the minion a successful build creates.

See [Minion Connection Schema](../contracts/minion-connection/) and
[Minion Build](../contracts/minion-build/).

## 4) The Data Plane

- Take minion traffic from channels three ways: the sync call
  (`POST /api/channel/sync`, a message per request), a connection socket per
  minion connection, and each channel's control link, over which core calls
  `bind-call` minions and opens `bind-persistent` ones
  ([Three paths](../contracts/channel-core-connections/#three-paths)).
- Admit only registered, unblocked channel instances, and check sizes before
  reading a message.
- Answer a minion's message with its reply (200), with nothing (204), as a
  replay (409), or as a frame that does not open (422). A message sent again
  within 10 minutes gets the reply it got
  ([Freshness and replay](../contracts/minion-messages/wire-format/#freshness-and-replay)).

See [Channel ↔ Core: HTTP Sync](../contracts/channel-core-sync/) and
[Connections](../contracts/channel-core-connections/).

## 5) Keys and Payload Crypto

- Generate each build's keys for its factory's suite, and give each minion
  process keys of its own when it stages.
- Seal and open every frame: core implements `aes-256-cbc-hmac-sha256`, and a
  factory declaring another suite of core's cannot register. A factory that
  translates a suite of its own makes its keys, and seals and opens its
  minions' frames for core over its factory link
  ([Codecs](../contracts/minion-messages/codecs/)).
- Keep channels out of it: they relay sealed frames. An
  [agentless channel](../contracts/agentless-channels/), which acts as the
  minion, is given the keys of the ids it serves.

See [Wire Format](../contracts/minion-messages/wire-format/).

## 6) Sessions and Tasks

- Open a session for each minion process that says hello, and keep its
  presence, its connections and what it said of its host.
- Queue operators' tasks within the commands the minion was built with, send
  them as the minion's connection allows, and keep their acks, output and
  results.
- Take what tasks return into the operation's views: listings into the
  [file browser](../contracts/file-browser/), files both ways
  ([File Transfers](../contracts/minion-messages/file-transfers/)), who a task
  ran as ([Identity](../contracts/minion-messages/identity/)).
- Run the fronts of minions' tunnels on core's operational ports, and the VPN
  front ([Tunnels](../contracts/minion-messages/tunnels/),
  [VPN Front](../contracts/vpn-front/)); carry other minions' traffic through
  a delegate ([Delegation](../contracts/minion-messages/delegation/)).
- Hand modules the credentials a field names
  ([Credentials](../contracts/credentials/)).

See [Minion Messages](../contracts/minion-messages/) and
[Task Results and Actions](../contracts/task-results-and-actions/).

## 7) Operators and Access

- Accounts, local login or single sign-on through OIDC, sessions, and roles:
  the account's own and its role in each operation (viewer, operator, admin).
- Enforce them on every operator action, in the web app and the APIs (GraphQL,
  REST, MCP for AI agents).

## Out of Scope for Core

- How a transport carries frames, and its framing: the channel's.
- How a minion is built: the factory's (core only checks what it builds against
  the factory's declared build schema).
- What a factory's own codec looks like: the factory translates it.

## Core Principle

`minion <-> core` is the real protocol conversation. Channels are transport
relays; an agentless channel, which acts as the minion, is the one exception.
