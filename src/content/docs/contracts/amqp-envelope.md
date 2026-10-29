---
title: "AMQP Message Envelope"
---

All control-plane messages on the RabbitMQ surface share one base envelope.
Contracts define only their `payload`; the surrounding fields are identical
everywhere. The exception is a live log batch, which travels as bare JSON with
no envelope ([Module Logs](../module-logs/#batches)).

For routing/exchange/queue naming see [AMQP Routing Conventions](../amqp-conventions/).

## Base envelope

Every RPC request and reply, and every event, carries these fields:

```json
{
  "message_id": "8f14e45f-ceea-4e6a-9c3b-2d1f0a7b6c5e",
  "correlation_id": "8f14e45f-ceea-4e6a-9c3b-2d1f0a7b6c5e",
  "type": "mgmt.config.apply",
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
| `message_id` | UUID string | yes | Unique id for this message. Control-plane operations are idempotent by their own keys (a build's `build_id`, an action's `invocation_id`, a configuration `revision`, a log `stream_id`), not by it. |
| `correlation_id` | UUID string | RPC only | Ties a reply to its request. Set equal to `message_id` on the originating request; copied verbatim onto the reply. Optional for fire-and-forget events. |
| `type` | string | yes | Dotted operation/event name (e.g. `mgmt.config.apply`). |
| `version` | string | yes | Contract version `MAJOR.MINOR`. RPC servers reject unknown major versions. |
| `timestamp` | RFC3339 string | yes | Producer's send time (UTC). |
| `source` | object | yes | Origin descriptor: `service` (`core` / `channel` / `factory`) and `instance` (deployment instance id). Core goes by `instance`: only the instance building a build may report on it. |
| `payload` | object | yes | Contract-specific body. May be `{}` for parameterless operations. |

## RPC reply envelope

RPC replies use the same base envelope with an added result block. The reply's
`correlation_id` always equals the request's `correlation_id`, and its `type`
and `version` are the request's.

```json
{
  "message_id": "3c9d2b7e-5a41-4f0e-8b6d-1e2f3a4b5c6d",
  "correlation_id": "8f14e45f-ceea-4e6a-9c3b-2d1f0a7b6c5e",
  "type": "mgmt.config.apply",
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
    "code": "validation_failed",
    "message": "configuration change failed validation"
  },
  "payload": {}
}
```

Error `code` values are enumerated per contract. Codes are stable identifiers
safe to branch on; `message` is human-facing and may change.

Every RPC server answers these the same way, before any contract's own rules:

| Code | When |
|---|---|
| `unsupported_version` | The request's major `version` is not one the server serves (1). |
| `validation_failed` | An unknown `type`, or a payload the operation cannot read. |
| `internal_error` | Anything else that went wrong in the handler. |

Core adds `unknown_instance` (a heartbeat or deregistration from an instance it
does not know) and `instance_blocked` (a registration from an instance an
operator blocked); contracts add their own, such as `not_found`, `busy` or
`action_unavailable`. A request that cannot be parsed, or that has no
`reply_to`, gets no reply: core discards it.

## Conventions

- **Time**: the envelope's `timestamp` is UTC RFC3339 with millisecond
  precision. Times inside a payload are RFC3339 too, at whatever precision and
  zone their contract says.
- **Ids** are random UUIDs (version 4) in their canonical lowercase form, e.g.
  `8f14e45f-ceea-4e6a-9c3b-2d1f0a7b6c5e`: the one id format across Logos. A
  receiver treats an id as an opaque string and reads nothing from it, not
  even a time or an order.
- **Unknown fields** are ignored by consumers (forward compatibility); producers
  must not rely on a consumer rejecting extra fields.
- **`type` and `payload` must agree** — a consumer that accepts a `type` commits
  to that `type`'s payload schema for the negotiated `version`.
