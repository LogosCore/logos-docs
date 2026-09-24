---
title: "ADR-0002: AMQP Contract Envelope and Routing Conventions"
---

## Status
Accepted

## Context

The control plane between core and modules runs over RabbitMQ, but the platform
had no frozen format for it. Two items were left open in the
[Architecture Draft](../../architecture/#pending-decisions) — "RabbitMQ
exchange/queue naming conventions and routing-key strategy" and "Message
contract format and versioning policy" — and the
[Module Types](../../module-types/) page explicitly asked for a decision that
freezes the base message envelope, the exchange/queue naming convention, and the
ownership boundaries.

Without these frozen, every control-plane contract (starting with transposition
profile management) would have to reinvent envelope fields, correlation, error
shape, and routing. That blocks the first concrete contract and risks
inconsistent behavior across modules.

A related decision is **where channel transposition profiles live**. Earlier
infrastructure notes implied a central database held the profile documents. That
conflicts with the established ownership model in which the channel module owns
runtime loading, validation, and execution of its profiles.

## Decision

Freeze a single shared AMQP envelope and one routing strategy for all
control-plane contracts.

### 1. Base envelope

Every AMQP message carries `message_id`, `correlation_id`, `type`, `version`,
`timestamp`, `source`, and `payload`. RPC replies add `status` and `error`. Ids
are ULIDs; timestamps are UTC RFC3339. Full field semantics live in
[AMQP Message Envelope](../../contracts/amqp-envelope/).

### 2. Routing conventions

- Direct exchanges for RPC: `logos.core.rpc`, `logos.channel.rpc`, `logos.factory.rpc`.
- Topic exchange for events: `logos.events`.
- Per-instance request queues `logos.<module-type>.rpc.<instance>` keyed by
  `<instance>`.
- Direct reply-to (`amq.rabbitmq.reply-to`) for replies, correlated by
  `correlation_id`.
- Hierarchical event routing keys `<module-type>.<instance>.<event>`.
- Dead-letter exchange `logos.dlx`; durable queues; per-queue ACLs.

Full strategy lives in [AMQP Routing Conventions](../../contracts/amqp-conventions/).

### 3. RPC ownership direction

Ownership is **per-operation**; the control plane is bidirectional. For module
**management** RPC (e.g. profile operations), core is the client and the module
is the server. For **lifecycle** RPC (register/heartbeat/deregister), the module
is the client and core is the server on `logos.core.rpc`.

:::note[Superseded]
An earlier revision of this ADR stated module RPC was one-directional (core
always client). That is corrected here and detailed in
[ADR-0003](../0003-module-registration-lifecycle/).
:::

### 4. Channel profiles are channel-owned, on-disk

Transposition profiles are stored as YAML files on each channel instance's local
disk. There is **no central profile database**. Durability across restarts is an
operational concern handled with **Docker volumes** mounted at the channel's
profile directory. Core manages profiles only through the
[profile RPC contract](../../contracts/channel-core-rpc/).

## Consequences

### Positive

- Unblocks the first control-plane contract (profile management RPC) and any
  future ones with a consistent envelope and routing.
- One correlation/error model across all modules simplifies clients and tracing.
- Channel-owned on-disk profiles keep channels self-contained and avoid coupling
  every channel to a shared database.

### Negative / Costs

- Operators must configure Docker volumes to persist profiles; a misconfigured
  channel loses its profiles on container replacement.
- Direct reply-to ties RPC clients to RabbitMQ-specific behavior.

### Tradeoffs

- Per-instance profile storage favors module independence over a single central
  view; core reconstructs a global picture via RPC and events rather than direct
  DB reads.

## Implementation Notes

This ADR supersedes the earlier implication that a central database stores
transposition profile documents. [Core Infrastructure](../../core-infrastructure/)
reflects the on-disk, volume-backed model.
