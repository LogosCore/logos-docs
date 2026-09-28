---
title: "Tech Requirements"
---

## Functional Requirements

## FR-01: Operator Authentication

- The system must support operator login with secure credential handling.
- The system must support role-based authorization for privileged operations.

## FR-02: Minion Registration

- The system must support controlled minion enrollment.
- The system must persist minion identity metadata and health status.

## FR-03: Tasking and Result Flow

- Operators must be able to create and queue tasks for minions.
- Minions must poll, execute tasks, and return results reliably.
- The system must retain task history with timestamps.

## FR-04: Modular Service Architecture

- The system must provide a **core server** as the central orchestration/control component.
- The system must support independent **modules** for capability-specific processing.
- Modules must communicate through the shared message bus and remain independently deployable.

## FR-05: RabbitMQ Messaging Backbone

- Core server and modules must communicate over RabbitMQ channels/queues.
- Minion traffic between channel and core must use request/response via HTTP (`POST /api/channel/sync`).
- Core HTTP response returns encrypted outbound payload for the same `id` (or encrypted no-op payload).
- Queue topology must support routing by message type and module responsibility.
- Critical message flows must support acknowledgements and retry/dead-letter behavior.

## FR-06: Application-Layer Minion Encryption

- Minion-to-Server payloads must be encrypted at application level end-to-end.
- Channel modules must not decrypt minion payloads.
- Channel modules may process only minimal routing metadata (`id`, channel metadata) and encrypted blobs.
- Channel modules act as transport-only relays and must not own Server protocol semantics.
- Core Server services must resolve key material/context using `id` and perform decrypt/verify.

## FR-07: Channel Envelope Delivery

- Channel modules must deliver well-formed `inbound.minion_message` envelopes to core.
- How a channel extracts `id` and `encrypted_data` from its transport is the channel's implementation detail.
- Channel modules must validate envelopes before sending to core.
- Channel modules must expose RabbitMQ RPC management endpoints for operational control.

## FR-08: Channel Performance

- Channel modules should handle inbound traffic efficiently at expected load.
- Channel modules should optimize their transport-to-envelope extraction path.

## FR-09: Auditability

- Security-relevant actions must be logged with actor, action, and time.
- Logs must be queryable for incident investigation.
- Module-originated actions must be traceable to message IDs/correlation IDs.
- Channel configuration changes must be auditable.

## Non-Functional Requirements

## NFR-01: Security

- All control-plane traffic must use encryption in transit.
- Minion payload confidentiality/integrity must be enforced with application-layer encryption.
- Decryption keys must be isolated to core Server services (not channel modules).
- Secrets must not be stored in plaintext.
- Authentication events must be auditable.

## NFR-02: Reliability

- Core server target uptime: >= 99.5% for MVP environments.
- Task state and messaging state must survive process restarts.
- Module failures should be isolated and must not crash unrelated services.

## NFR-03: Performance

- Operator command response time target: p95 < 500 ms for metadata operations.
- Minion check-in handling must scale to expected MVP load.

## NFR-04: Maintainability

- Codebase must include lint/test automation.
- Core design decisions must be documented via ADR.

## Constraints

- Hosted documentation and CI/CD on GitHub.
- Runtime architecture is containerized and orchestrated with Docker Compose for MVP.
- Messaging between core server and modules uses RabbitMQ.
- Stack choices must prioritize fast iteration for MVP.

## Open Questions

1. Expected maximum number of concurrent minions for MVP?
2. Required persistence technology and retention window?
3. Required authentication providers for operators?
