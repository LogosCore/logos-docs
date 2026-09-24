---
title: "AMQP Message Envelope"
---

All control-plane messages on the RabbitMQ surface share one base envelope.
Contracts define only their `payload`; the surrounding fields are identical
everywhere. This is the format frozen in
[ADR-0002](../../adr/0002-amqp-contract-conventions/).

For routing/exchange/queue naming see [AMQP Routing Conventions](../amqp-conventions/).

## Base envelope

Every AMQP message — request, reply, or event — carries these fields:

```json
{
  "message_id": "01JNX6R8VQ2H3CN4K9EJ1T2Z7M",
  "correlation_id": "01JNX6R8VQ2H3CN4K9EJ1T2Z7M",
  "type": "transposition.profile.create",
  "version": "1.0",
  "timestamp": "2026-06-20T21:05:12.481Z",
  "source": {
    "service": "core",
    "instance": "core-1"
  },
  "payload": {}
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `message_id` | ULID string | yes | Unique id for this message. Basis for idempotent processing. |
| `correlation_id` | ULID string | RPC only | Ties a reply to its request. Set equal to `message_id` on the originating request; copied verbatim onto the reply. Optional for fire-and-forget events. |
| `type` | string | yes | Dotted operation/event name (e.g. `transposition.profile.create`). |
| `version` | string | yes | Contract version `MAJOR.MINOR`. Consumers reject unknown major versions. |
| `timestamp` | RFC3339 string | yes | Producer's send time (UTC). |
| `source` | object | yes | Origin descriptor: `service` (`core` / `channel` / `minion-factory`) and `instance` (deployment instance id). |
| `payload` | object | yes | Contract-specific body. May be `{}` for parameterless operations. |

## RPC reply envelope

RPC replies use the same base envelope with an added result block. The reply's
`correlation_id` always equals the request's `correlation_id`.

```json
{
  "message_id": "01JNX7D8H8QY3G6P2R4X1K8ABC",
  "correlation_id": "01JNX6R8VQ2H3CN4K9EJ1T2Z7M",
  "type": "transposition.profile.create",
  "version": "1.0",
  "timestamp": "2026-06-20T21:05:12.690Z",
  "source": {
    "service": "channel",
    "instance": "channel-http-1"
  },
  "status": "ok",
  "error": null,
  "payload": {}
}
```

| Field | Type | Meaning |
|---|---|---|
| `status` | `ok` \| `error` | Outcome of the RPC. |
| `error` | object \| null | Present when `status == error`: `{ "code": "...", "message": "..." }`. `null` on success. |
| `payload` | object | Result data on success. `{}` when the operation returns no data. |

### Error shape

```json
{
  "status": "error",
  "error": {
    "code": "overlap_conflict",
    "message": "profile would ambiguously match enabled profile p-2b77df"
  },
  "payload": {}
}
```

Error `code` values are enumerated per contract. Codes are stable identifiers
safe to branch on; `message` is human-facing and may change.

## Conventions

- **Time** is always UTC RFC3339 with millisecond precision.
- **Ids** are [ULID](https://github.com/ulid/spec)s — lexicographically
  sortable, collision-resistant, and timestamp-prefixed.
- **Unknown fields** are ignored by consumers (forward compatibility); producers
  must not rely on a consumer rejecting extra fields.
- **`type` and `payload` must agree** — a consumer that accepts a `type` commits
  to that `type`'s payload schema for the negotiated `version`.
