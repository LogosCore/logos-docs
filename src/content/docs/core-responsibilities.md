---
title: "Core Responsibilities"
---

`logos-core` is the control-plane heart of the system. This page lists what it
does today, and what it is meant to do once minion payloads and tasking land.

## Built Today

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

## 4) The Data Plane Endpoint

- Accept canonical channel requests (`inbound.minion_message`) on
  `POST /api/channel/sync`, and check their fields.
- Admit only registered, unblocked channel instances (403 otherwise, 503 when
  the registry cannot be read).
- Answer a message seen before (by `message_id`, within 24 hours) with a no-op.
- Return a canonical outbound envelope (`outbound.minion_message`). Today it is
  always empty: there is nothing to send minions yet.

See [Channel ↔ Core: HTTP Sync](../contracts/channel-core-sync/).

## 5) Operators and Access

- Accounts, local login or single sign-on through OIDC, sessions, and roles:
  the account's own and its role in each operation (viewer, operator, admin).
- Enforce them on every operator action, in the web app and the APIs (GraphQL,
  REST, MCP for AI agents).

## Planned

## 6) Key Ownership and Crypto Boundary

- Own key material for minion payloads app-level encryption.
- Resolve key context using canonical routing `id`.
- Decrypt/verify inbound encrypted payloads.
- Encrypt/sign outbound payloads.
- Keep channels plaintext-blind (channels never decrypt payloads).

The payload crypto contract is not written yet. Core refuses to build for a
factory that declares crypto suites until it is.

## 7) Task and Session Orchestration

- Decide what outbound tasking is pending for each `id`, within the commands
  its minion was built with.
- Correlate inbound results with task context.
- Persist task history and execution state.
- Apply policy checks before task execution paths.

Minions exist today only as the records successful builds create. The tasks
board in the web app is the operators' own planning, not minion tasking.

## Out of Scope for Core

- Transport-specific delivery mechanics (owned by channel modules).
- Transposition rendering/parsing details in transport payloads (owned by channel modules, using shared SDKs).
- Minion transport protocol quirks beyond canonical contracts.
- How a minion is built: the factory's (core only checks what it builds against
  the factory's declared build schema).

## Core Principle

`minion <-> core` is the real protocol conversation.
Channels are transport relays.
