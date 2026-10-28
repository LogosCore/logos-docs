---
title: "Channel ↔ Core: HTTP Sync"
---

This is the **data-plane** contract between a channel module and the core Server.
It defines the two canonical envelopes that carry minion traffic as opaque
encrypted blobs over HTTP.

How a channel module receives traffic from a minion, what transport protocol it
uses, and how it extracts or embeds the canonical fields is entirely the
channel's concern and outside this contract.

## Endpoint

```
POST /api/channel/sync
Content-Type: application/json
```

The endpoint sits outside core's operator API (`/api/v1`): no session, no CSRF
token. Nothing authenticates the channel yet; core admits a request by the
instance id the channel asserts (the registration gate, below). nginx forwards
it with the rest of `/api/`.

## `inbound.minion_message` (request body)

Channel → core. One per inbound minion interaction.

```json
{
  "message_id": "c4ca4238-a0b9-4382-8dcc-509a6f75849b",
  "type": "inbound.minion_message",
  "version": "1.0",
  "timestamp": "2026-03-09T21:05:12.481Z",
  "source": {
    "module": "channel-core",
    "module_instance": "http-main",
    "transport": "channel",
    "tenant": "default"
  },
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "encrypted_data": "QkM4V1R...",
  "meta": {
    "trace_id": "tr-6fd92d8b"
  }
}
```

### Field reference

| Field | Required | Description |
|---|---|---|
| `message_id` | yes | Unique per request, a UUIDv4. Used by core for idempotency dedup. |
| `type` | yes | Must be `"inbound.minion_message"`. |
| `version` | yes | `"1.0"`. Core does not check it yet. |
| `timestamp` | yes | RFC 3339. |
| `source.module` | yes | Identifies the sending module kind. |
| `source.module_instance` | yes | The registered instance id. Core checks this against the registration gate. |
| `source.transport` | yes | Transport identifier (e.g. `"channel"`). |
| `source.tenant` | yes | Tenant scope (e.g. `"default"`). |
| `id` | yes | The minion's id: the `minion_id` of the build that made it. Opaque to channel. |
| `encrypted_data` | yes | Opaque encrypted payload. Channel must not inspect or modify. |
| `meta` | no | Optional metadata (e.g. `trace_id`). |

### Core-side validation

1. `type == "inbound.minion_message"`.
2. `message_id`, `id`, `encrypted_data`, `source.module_instance` are non-empty.
3. `timestamp` parses as RFC 3339.
4. **Registration gate** — `source.module_instance` must be an instance in
   status `registered`, via the [Module Lifecycle](../module-lifecycle/)
   contract, of any module type. An unknown, deregistered, dead or blocked
   instance → **403**. Registry unavailable → **503** (fails closed). Core
   caches a positive answer for one heartbeat interval, and drops it at once
   when the instance deregisters, is declared dead, blocked or deleted.
5. **Idempotency** — `message_id` is deduped via `SetNX` with a 24-hour window.
   Replay of an already-seen `message_id` returns a valid no-op outbound
   (not an error). The dedup fails open: with the cache disabled or failing,
   every message is processed.

The gate runs before the dedup, so an unregistered sender never takes a dedup
slot.

---

## `outbound.minion_message` (response body)

Core → channel. Returned in the same HTTP response.

```json
{
  "message_id": "3c9d2b7e-5a41-4f08-b6e2-91d7c0a4e8f3",
  "type": "outbound.minion_message",
  "version": "1.0",
  "timestamp": "2026-03-09T21:05:12.690Z",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "encrypted_data": "U2FtcGxlRW5jcnlwdGVkQmxvYg==",
  "meta": {
    "status": "ok",
    "trace_id": "tr-6fd92d8b"
  }
}
```

### Field reference

| Field | Required | Description |
|---|---|---|
| `message_id` | yes | Core-assigned, unique, a UUIDv4. |
| `type` | yes | `"outbound.minion_message"`. |
| `version` | yes | `"1.0"`. |
| `timestamp` | yes | RFC 3339. |
| `id` | yes | Same `id` from the inbound message. |
| `encrypted_data` | yes | Opaque encrypted response payload. May be empty/no-op when nothing is pending. |
| `meta` | no | `status: "ok"`, and the request's `trace_id` when it had one. |

### Channel-side validation

`protocol.ValidateOutbound`, which channel-core's sync client and runtime run
on every reply, requires:

1. `type == "outbound.minion_message"`.
2. `message_id`, `version`, `id` and `encrypted_data` are non-empty.
3. `timestamp` parses as RFC 3339.

A channel should also check that `id` matches the inbound request's `id`; no
channel does yet.

:::caution[Today]
Core holds no minion keys and has no tasking yet, so it answers every valid
request with `encrypted_data: ""`. That reply fails `ValidateOutbound`:
channel-core's sync client and runtime refuse it. `logos-http-channel`, which
has its own sync client and checks nothing, relays it. Which side changes, the
check or the reply, is still to be settled.
:::

---

## Response codes

| Code | Meaning |
|---|---|
| **200** | Success. Body is `outbound.minion_message`. |
| **400** | Invalid inbound envelope (missing/malformed fields). Body `{"error": "invalid input"}`. |
| **403** | `source.module_instance` is not a registered instance. Body `{"error": "channel not registered"}`. |
| **503** | Registration gate unavailable (fails closed). Body `{"error": "registry unavailable"}`. |

## Processing semantics

- One `inbound.minion_message` per HTTP request, one `outbound.minion_message` per response.
- Core decrypts inbound and encrypts outbound (planned, with the payload crypto
  contract). Channel never decrypts.
- When no work is pending for an `id`, core returns an empty/no-op
  `encrypted_data`. Today that is every reply.
- Channel relays `encrypted_data` to the minion unchanged.
