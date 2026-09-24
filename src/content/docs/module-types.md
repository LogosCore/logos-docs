---
title: "Module Types"
---

This page defines initial module categories in the Logos modular architecture.

## 1) Channel Modules

Channel modules provide transport paths between minions and the core Server platform.

### Responsibilities

- Accept inbound minion traffic from a specific transport/platform.
- Extract/maintain minimal routing metadata (`id` + channel context).
- Treat minion payload as opaque encrypted blob (no decrypt/inspect).
- Send inbound HTTP request to core sync endpoint (`POST /api/channel/sync`).
- Wait for HTTP response from core and relay returned encrypted payload back to minion.
- Implement transport-specific response delivery (`poll`/long-poll/webhook reply/etc.).
- Load and apply transposition profiles (extract/re-embed `id` and `encrypted_data`).
- Resolve profile selection from transport `profile_id` hint when present; otherwise match against enabled profiles.
- Persist and manage YAML transposition profiles.
- Expose RabbitMQ RPC management actions for profile CRUD/activation/validation.
- Maintain usage statistics and source-affinity cache for profile selection optimization.
- Handle transport-specific concerns (sessions, polling cadence, retries, rate limits).

### Examples

- HTTP(S) channel
- Telegram channel
- GitHub channel
- DNS channel
- WebSocket channel

### Notes

- Keep transport logic isolated from business/tasking logic.
- Channel modules are blind to minion plaintext by design.
- Channel role is packet/blob shuffling + HTTP relay reliability, not Logos semantics.
- The real protocol peer is core Server, not the channel module.
- Enforce per-channel authentication and abuse controls.
- Expose channel health and queue lag metrics.

## 2) Minion Factory Modules

Minion factory modules define minion families and lifecycle behavior.

### Responsibilities

- Build/generate minions for a target platform/profile.
- Define the command set supported by a specific minion family.
- Preprocess operator/core commands into minion-specific wire format.
- Postprocess raw minion responses into structured events/results.
- Manage minion metadata/capabilities and compatibility versions.

### Examples

- Go minion factory
- .NET minion factory
- Python minion factory

### Optional Translator Hooks

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
- Version command contracts per minion factory.
- Track capability flags per minion build (supported commands/features).

## Cross-Cutting Module Requirements

All module types should:

- Register with core on startup and heartbeat for liveness via the [Module Lifecycle](../contracts/module-lifecycle/) contract.
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

1. Base message envelope and versioning — [ADR-0002](../adr/0002-amqp-contract-conventions/) / [AMQP Message Envelope](../contracts/amqp-envelope/).
2. Exchange/queue naming convention — [AMQP Routing Conventions](../contracts/amqp-conventions/).
3. The first concrete module↔core contract — [Channel ↔ Core: Profile RPC](../contracts/channel-core-rpc/).

Still open: minion-factory build-coordination contract, and module packaging/lifecycle policy.
