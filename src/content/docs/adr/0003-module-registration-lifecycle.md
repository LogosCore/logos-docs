---
title: "ADR-0003: Module Registration and Lifecycle"
---

## Status
Accepted

## Context

[ADR-0002](../0002-amqp-contract-conventions/) initially framed module↔core RPC
as one-directional: core the client, module the server. That is wrong. A module
must **announce itself** to core before core can address it — core cannot send a
management RPC to a channel it does not yet know exists. Registration is
inherently module→core, which makes the control plane bidirectional and ownership
**per-operation** rather than global.

Several lifecycle details were undecided: how a module is identified, how core
detects that a module has died, where the registry lives, and whether
registration expects a reply.

## Decision

Add a generic **Module Lifecycle** contract (module→core RPC, core is server)
covering `module.register`, `module.heartbeat`, and `module.deregister`. It
applies to all module types. Full spec:
[Module Lifecycle (Registration)](../../contracts/module-lifecycle/).

### 1. Bidirectional control plane

Ownership is per-operation:

- **Lifecycle** (register/heartbeat/deregister) — module is client, **core is
  server**, on a new exchange/queue `logos.core.rpc`.
- **Management** (e.g. `transposition.profile.*`) — core is client, **module is
  server**, on `logos.<module-type>.rpc.<instance>`.
- **Events** — module→core pub/sub on `logos.events`.

This supersedes the "RPC ownership direction" decision in ADR-0002.

### 2. Module identity: `module_name` + `instance`

A registration carries two identity fields. `module_name` is the module's
**hardcoded identity** — its project/kind (`http`, `telegram`, ...), baked into
the implementation and shared by every running copy of that module. `instance`
is the **unique id of one deployed instance**, self-assigned by the module from
its env/config. Core mints neither. An operator may run several instances of the
same `module_name`, each with a distinct `instance`. Re-registration of the same
`instance` (e.g. after restart) is an **idempotent takeover**: core upserts the
record and resumes; no duplicate, no error. Most recent registration wins.

### 3. Explicit heartbeat liveness

Modules send `module.heartbeat` on an interval returned in the register ack
(default 30s). Core marks an instance dead after a configurable number of missed
beats (default 3 → 90s) and stops addressing it until it re-registers. Liveness
does not depend on broker connection topology.

### 4. Registry persisted in MongoDB

Core stores the module registry in MongoDB for a durable view across restarts and
historical audit of which modules existed when. This is the **module registry**
only — channel transposition profiles remain channel-owned on local disk per
[ADR-0002](../0002-amqp-contract-conventions/).

### 5. Registration is RPC with ack + config

`module.register` is request/reply. Core acks and returns bootstrap config
(heartbeat interval, expected contract versions, policy, feature flags). The
module knows core received it — and is alive — before it begins serving
management calls.

## Consequences

### Positive

- Core dynamically discovers modules instead of relying on static wiring.
- One generic lifecycle contract serves every module type.
- Durable registry survives core restarts; modules re-register to reconcile.
- Per-operation ownership cleanly separates lifecycle from management.

### Negative / Costs

- Core now exposes its own RPC server surface (`logos.core.rpc`) to maintain.
- Heartbeat traffic and a liveness reaper add moving parts.
- Self-assigned ids push instance-uniqueness discipline to operators.

### Tradeoffs

- Explicit heartbeats over broker-presence detection: more messages, but
  topology-independent and explicit in the contract.
- MongoDB-backed registry over in-memory: durability and audit at the cost of a
  DB dependency on the lifecycle path.

## Implementation Notes

Updates ADR-0002's ownership section and the AMQP routing conventions to add the
`logos.core.rpc` exchange. [Core Infrastructure](../../core-infrastructure/) lists
the module registry among MongoDB's stored collections.
