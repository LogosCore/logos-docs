---
title: "Core Responsibilities"
---

`logos-core` is the control-plane heart of the system.

It is the only component that owns and uses decryption keys for minion payloads.

## Primary Responsibilities

## 1) Key Ownership and Crypto Boundary

- Own key material for minion payloads app-level encryption.
- Resolve key context using canonical routing `id`.
- Decrypt/verify inbound encrypted payloads.
- Encrypt/sign outbound payloads.
- Keep channels plaintext-blind (channels never decrypt payloads).

## 2) Protocol and Message Orchestration

- Accept canonical channel requests (`inbound.minion_message`).
- Validate message envelope and schema version.
- Route payloads into internal processing pipeline.
- Return canonical outbound envelope (`outbound.minion_message`).

## 3) Task and Session Orchestration

- Manage minion lifecycle and state.
- Decide what outbound tasking is pending for each `id`.
- Correlate inbound results with task/session context.
- Persist task history and execution state.

## 4) Module Coordination

- Coordinate channel modules and minion-factory modules.
- Define and enforce internal contracts between modules.
- Provide control-plane APIs for module management.

## 5) Data and Audit Integrity

- Persist canonical events, task records, and audit logs.
- Ensure traceability via `message_id` / `correlation` context.
- Record sensitive actions and profile/key-affecting changes.

## 6) Policy and Access Control

- Enforce RBAC/authorization for operator actions.
- Apply policy checks before task execution paths.
- Maintain security posture at control-plane boundary.

## 7) Reliability and Recovery

- Enforce idempotency on inbound/outbound processing.
- Handle retries/replay protection safely.
- Maintain consistency across restarts.

## Out of Scope for Core

- Transport-specific delivery mechanics (owned by channel modules).
- Transposition rendering/parsing details in transport payloads (owned by channel modules, using shared SDKs).
- Minion transport protocol quirks beyond canonical contracts.

## Core Principle

`minion <-> core` is the real protocol conversation.
Channels are transport relays.
