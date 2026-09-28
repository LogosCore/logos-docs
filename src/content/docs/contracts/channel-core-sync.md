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

## `inbound.minion_message` (request body)

Channel → core. One per inbound minion interaction.

```json
{
  "message_id": "http-main-1741554312481000000",
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
| `message_id` | yes | Unique per request. Used by core for idempotency dedup. |
| `type` | yes | Must be `"inbound.minion_message"`. |
| `version` | yes | `"1.0"`. |
| `timestamp` | yes | RFC 3339. |
| `source.module` | yes | Identifies the sending module kind. |
| `source.module_instance` | yes | The registered instance id. Core checks this against the registration gate. |
| `source.transport` | yes | Transport identifier (e.g. `"channel"`). |
| `source.tenant` | yes | Tenant scope (e.g. `"default"`). |
| `id` | yes | Minion/session identifier. Opaque to channel. |
| `encrypted_data` | yes | Opaque encrypted payload. Channel must not inspect or modify. |
| `meta` | no | Optional metadata (e.g. `trace_id`). |

### Core-side validation

1. `type == "inbound.minion_message"`.
2. `message_id`, `id`, `encrypted_data`, `source.module_instance` are non-empty.
3. `timestamp` parses as RFC 3339.
4. **Registration gate** — `source.module_instance` must be registered via the
   [Module Lifecycle](../module-lifecycle/) contract. Unregistered → **403**.
   Registry unavailable → **503** (fails closed).
5. **Idempotency** — `message_id` is deduped via `SetNX` with a TTL window.
   Replay of an already-seen `message_id` returns a valid no-op outbound
   (not an error).

---

## `outbound.minion_message` (response body)

Core → channel. Returned in the same HTTP response.

```json
{
  "message_id": "01JNX7D8H8QY3G6P2R4X1K8ABC",
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
| `message_id` | yes | Core-assigned, unique. |
| `type` | yes | `"outbound.minion_message"`. |
| `version` | yes | `"1.0"`. |
| `timestamp` | yes | RFC 3339. |
| `id` | yes | Same `id` from the inbound message. |
| `encrypted_data` | yes | Opaque encrypted response payload. May be empty/no-op when nothing is pending. |
| `meta` | no | Optional (e.g. `status`, `trace_id`). |

### Channel-side validation

1. `type == "outbound.minion_message"`.
2. `id` matches the inbound request's `id`.
3. `encrypted_data` is present (treat as opaque).

---

## Response codes

| Code | Meaning |
|---|---|
| **200** | Success. Body is `outbound.minion_message`. |
| **400** | Invalid inbound envelope (missing/malformed fields). |
| **403** | `source.module_instance` is not registered. |
| **503** | Registration gate unavailable (fails closed). |

## Processing semantics

- One `inbound.minion_message` per HTTP request, one `outbound.minion_message` per response.
- Core decrypts inbound and encrypts outbound. Channel never decrypts.
- When no work is pending for an `id`, core returns an empty/no-op `encrypted_data`.
- Channel relays `encrypted_data` to the minion unchanged.
