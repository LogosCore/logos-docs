---
title: "Channel ↔ Core: HTTP Sync"
---

This is the **data-plane** contract between a channel module and the core Server.
It carries minion traffic as opaque encrypted blobs over HTTP. For the
control-plane (profile management) contract between the same parties, see
[Channel ↔ Core: Profile RPC](../channel-core-rpc/).

## Model

- Canonical channel-core model is only `id` + `encrypted_data`.
- Minion/channel transport may use transposition placement (headers/query/cookies/body/etc.) defined by active profile.
- Channel normalizes transport payload to canonical form before calling core.
- Channel sends HTTP request to core: `POST /api/channel/sync`.
- Core responds with `outbound.minion_message` containing encrypted data.
- Channel applies profile mapping for outbound transport response.

---

## `inbound.minion_message` (HTTP request body)

Purpose: channel-to-core request carrying inbound encrypted minion data.

### Body (v1)

```json
{
  "message_id": "01JNX6R8VQ2H3CN4K9EJ1T2Z7M",
  "type": "inbound.minion_message",
  "version": "1.0",
  "timestamp": "2026-03-09T21:05:12.481Z",
  "source": {
    "module": "channel-http",
    "module_instance": "channel-http-1",
    "transport": "http",
    "tenant": "default"
  },
  "id": "s-2b77df",
  "encrypted_data": "QkM4V1R...",
  "meta": {
    "receive_count": 1,
    "trace_id": "tr-6fd92d8b"
  }
}
```

### Validation rules

Channel-side (minion -> channel):
- Require non-empty `id`.
- Require non-empty `encrypted_data`.
- Treat `encrypted_data` as opaque.

Core-side (HTTP request body):
- Require `type == inbound.minion_message`.
- Require `id` and `encrypted_data`.
- Require parseable RFC3339 `timestamp`.

---

## `outbound.minion_message` (HTTP response body)

Purpose: core-to-channel response for the same `id`, carrying only encrypted outbound data.

### Body (v1)

```json
{
  "message_id": "01JNX7D8H8QY3G6P2R4X1K8ABC",
  "type": "outbound.minion_message",
  "version": "1.0",
  "timestamp": "2026-03-09T21:05:12.690Z",
  "id": "s-2b77df",
  "encrypted_data": "U2FtcGxlRW5jcnlwdGVkQmxvYg==",
  "meta": {
    "status": "ok",
    "trace_id": "tr-6fd92d8b"
  }
}
```

### Response semantics

- Response exposes only one payload field: `encrypted_data`.
- `encrypted_data` is opaque to channel.
- When no work is pending, core returns an empty/no-op encrypted payload.
- Channel relays `encrypted_data` to minion unchanged.

### Validation rules

Channel-side (HTTP response body):
- Require `type == outbound.minion_message`.
- Require matching `id`.
- Require `encrypted_data` field.
- Treat `encrypted_data` as opaque.

---

## Processing expectations

- Channel sends `inbound.minion_message` to `POST /api/channel/sync` per minion inbound message.
- Core processes inbound payload and returns `outbound.minion_message` in the same HTTP exchange.
- Core decrypts/verifies inbound and encrypts outbound; channel never decrypts.
- Core may return an empty/no-op encrypted payload when no task is pending for that `id`.
