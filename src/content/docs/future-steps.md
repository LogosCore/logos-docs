---
title: "Future Steps & Ideas"
---

This page tracks planned follow-ups and open ideas that are not yet finalized as ADRs.

## Near-Term Next Steps

- Define and approve base message envelope:
  - `message_id`
  - `correlation_id`
  - `type`
  - `version`
  - `timestamp`
  - `payload`
- Define RabbitMQ topology:
  - exchange strategy
  - routing keys
  - queue naming conventions
  - dead-letter and retry queues
- Freeze module ownership boundaries:
  - what belongs to `channel`
  - what belongs to `minion factory`

## Implementation Ideas

- Create a `contracts` package with shared message schemas.
- Add contract tests between core server and modules.
- Add a compose profile per environment (`dev`, `staging`, `lab`).
- Add module health dashboard (queue lag, error rates, processing latency).
- Add module version compatibility matrix (core vs modules).

## Security & Reliability Ideas

- Enforce per-module RabbitMQ credentials and least-privilege permissions.
- Introduce message signing/integrity checks for sensitive flows.
- Add idempotency keys for command execution paths.
- Define replay protection strategy for delayed/retried messages.

## Documentation Workflow Ideas

- Promote stable ideas from this page into ADRs.
- Keep this page as a staging area for architecture discussions.
- Review and prune completed items every sprint.

## Candidate ADR Backlog

1. Message envelope and schema versioning policy.
2. RabbitMQ topology standard.
3. Module lifecycle and compatibility policy.
4. Error handling and retry semantics.
5. Observability baseline (logs, metrics, traces).
6. Minion payload cryptography boundary and key-management policy.
