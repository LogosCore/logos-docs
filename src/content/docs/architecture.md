---
title: "Architecture Draft"
---

## High-Level Components

- **Core Server**: central control plane for authentication, orchestration, policy enforcement, and module lifecycle.
- **Operator UI / API Client**: operator-facing interface for tasking, monitoring, and administration.
- **Module Services**: independent services implementing capabilities (for example: task dispatcher, result processor, notification service).
- **Message Bus (RabbitMQ)**: asynchronous communication backbone between core server and modules via channels/queues.
- **Persistence Layer**: durable storage for users, minions, tasks, module state, and audit logs.
- **Telemetry / Logging**: centralized collection of operational and security events.

## Communication Ownership Model

- The logical conversation is **minion ↔ core Server**.
- A channel module is only a transport relay between minion and core Server.
- Channel modules deliver canonical envelopes containing opaque encrypted blobs plus minimal routing metadata (`id`).
- Channel modules are not protocol peers for minion business logic and must stay plaintext-blind.
- How a channel module receives traffic from its transport and extracts the
  canonical fields is the channel's implementation detail — core defines only
  the envelope contract.

## Communication Model

- Modules do not call each other directly by default.
- Core server and modules communicate over RabbitMQ channels.
- Minion-to-Logos payloads are application-layer encrypted end-to-end.
- Channel modules do not decrypt minion payloads; they relay `id` + `encrypted_data` in canonical envelopes.
- Core exposes a dedicated channel sync HTTP endpoint (`POST /api/channel/sync`).
- Channel → core minion traffic is request/response over HTTP.
- On inbound request, core returns an encrypted outbound payload in the same HTTP response (tasking may be embedded inside ciphertext).
- Channel management between core and channel uses RabbitMQ RPC control calls.
- Only core Logos services hold decryption keys and perform decrypt/verify operations.
- Messages should be schema-versioned and idempotent where possible.
- Critical flows should use acknowledgements/retries and dead-letter queues.

## Initial Deployment Shape

- Docker Compose orchestrates all services for MVP environments.
- Services include: core server, RabbitMQ, database, and selected modules.
- Optional reverse proxy can handle TLS termination for operator/API entrypoints.

## Trust Boundaries

- Internet/minion network to core server entrypoint.
- Operator network to core server entrypoint.
- Core server/modules to RabbitMQ.
- Core server/modules to database.

## Baseline Security Controls

- Encrypted transport for all external/control-plane traffic.
- Application-layer E2E encryption for minion payloads (`minion` ↔ `core Server`).
- Decryption keys are available only to core Server services.
- Channel modules operate as blind routers for encrypted blobs.
- RBAC for all operator actions.
- Queue access control per service/module in RabbitMQ.
- Strict audit logging for sensitive workflows and module-triggered actions.

## Pending Decisions

1. ~~RabbitMQ exchange/queue naming conventions and routing-key strategy.~~  Resolved — see [AMQP Routing Conventions](../contracts/amqp-conventions/).
2. ~~Message contract format and versioning policy.~~  Resolved — see [AMQP Message Envelope](../contracts/amqp-envelope/).
3. ~~Database engine and schema partitioning strategy.~~ Resolved — see [Core Infrastructure](../core-infrastructure/) (MongoDB).
4. Module packaging and lifecycle policy (enable/disable/version compatibility).
