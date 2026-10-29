---
title: "Channel ↔ Core: HTTP Sync"
---

:::caution[Draft: raw body]
The sync call is moving from a JSON envelope with base64 `encrypted_data` to
the ciphertext as the raw HTTP body, with the envelope fields in headers. See
[Raw body](#raw-body-agreed-not-built) at the end of this page: agreed, not
built. Until it ships with the coordinated release, the JSON envelope below is
what core and the channels speak.
:::

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
| `encrypted_data` | yes | Opaque encrypted response payload; empty when core has nothing for the minion. |
| `meta` | no | `status: "ok"`, and the request's `trace_id` when it had one. |

### Channel-side validation

`protocol.ValidateOutbound`, which channel-core's sync client and runtime run
on every reply, requires:

1. `type == "outbound.minion_message"`.
2. `message_id`, `version` and `id` are non-empty. `encrypted_data` may be
   empty: core has nothing for the minion.
3. `timestamp` parses as RFC 3339.

A channel should also check that `id` matches the inbound request's `id`; no
channel does yet.

Core holds no minion keys and has no tasking yet, so today it answers every
valid request with `encrypted_data: ""`. Channels relay that reply like any
other: `logos-http-channel` answers the minion with the packed id alone.

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
- When nothing is pending for an `id`, core returns an empty
  `encrypted_data`. Today that is every reply.
- Channel relays `encrypted_data` to the minion unchanged.

---

## Raw body (agreed, not built)

The ciphertext travels as the HTTP body, byte for byte. The envelope fields
that are left become headers. Core and every channel switch together, in one
release: core does not accept both forms.

### Request

```http
POST /api/channel/sync
Content-Type: application/octet-stream
Content-Length: 1048698
Logos-Message-Id: c4ca4238-a0b9-4382-8dcc-509a6f75849b
Logos-Minion-Id: 550e8400-e29b-41d4-a716-446655440000
Logos-Channel-Instance: http-main
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01

<ciphertext bytes>
```

| Part | Required | Meaning |
|---|---|---|
| `Content-Type` | yes | `application/octet-stream`. Anything else → **415**. |
| Body | yes | The minion's ciphertext, as the minion sent it once the channel has undone its own transport encoding. Not empty. At most core's sync size limit (a core setting). |
| `Logos-Message-Id` | yes | Unique per request, a UUIDv4. Core dedups on it. |
| `Logos-Minion-Id` | yes | The minion's id: the `minion_id` of the build that made it, as a lowercase UUID. |
| `Logos-Channel-Instance` | yes | The sending channel's registered instance id, for the registration gate. |
| `traceparent` | no | [W3C Trace Context](https://www.w3.org/TR/trace-context/). Core logs its trace id and returns the header. |

Header names are case-insensitive, as in all of HTTP.

### Core-side checks

In this order, so core reads no body for a request it will refuse:

1. `Content-Type` → **415**; a missing or malformed header → **400**.
2. **Registration gate** on `Logos-Channel-Instance`, as today: **403**, or
   **503** when the registry is unavailable.
3. **Size**: a `Content-Length` over the limit → **413** before the body is
   read; a body without one is cut off at the limit, also **413**. An empty
   body → **400**.
4. **Idempotency** on `Logos-Message-Id`, as today: a replay gets **204**, not
   an error.

### Response

```http
HTTP/1.1 200 OK                          HTTP/1.1 204 No Content
Content-Type: application/octet-stream   Logos-Message-Id: 3c9d2b7e-…
Logos-Message-Id: 3c9d2b7e-…             Logos-Minion-Id: 550e8400-…
Logos-Minion-Id: 550e8400-…
                                         (nothing for the minion)
<ciphertext bytes>
```

| Code | Meaning |
|---|---|
| **200** | The body is ciphertext for the minion. |
| **204** | Nothing for the minion. Today every valid request gets this. |
| **400** | A header missing or malformed, or an empty body. |
| **403** | `Logos-Channel-Instance` is not a registered instance. |
| **413** | The body is over the size limit. |
| **415** | The body is not `application/octet-stream`. |
| **503** | The registration gate is unavailable (fails closed). |

Both success replies carry `Logos-Message-Id` (core's own, a UUIDv4) and
`Logos-Minion-Id` (the request's), and `traceparent` when the request had one.
Every error has a JSON body, `{"error": "…"}` with `Content-Type:
application/json`, so a channel tells a reply from an error by the status
code. A channel checks that `Logos-Minion-Id` is the one it sent, and relays a
200 body to the minion unchanged.

### From the JSON envelope

| JSON envelope | Raw body |
|---|---|
| `encrypted_data` (base64 by convention) | The body |
| `encrypted_data: ""` in a reply | **204 No Content** |
| `message_id` | `Logos-Message-Id` |
| `id` | `Logos-Minion-Id` |
| `source.module_instance` | `Logos-Channel-Instance` |
| `meta.trace_id` | `traceparent` |
| `type`, `version`, `timestamp`, `source.module`, `source.transport`, `source.tenant`, `meta.status` | Dropped: the endpoint and the status code say what they said, core stamps its own receive time, and the rest were constant. |

### Design notes

- **Why a raw body.** The ciphertext is bytes and JSON has no type for them,
  so the envelope carried them as a base64 string. That costs a third more on
  the channel ↔ core hop and three or four copies of each payload (the body,
  the JSON string, the decoded bytes) on both sides. Nothing specified the
  encoding either: `logos-http-channel` sends base64, while channel-core's
  profile runtime sends whatever its transforms decode to. Raw bytes from such
  a profile would not even survive the trip, since Go's JSON encoder replaces
  invalid UTF-8 with U+FFFD. With a raw body there is no conversion to get
  wrong, `Content-Length` lets core refuse an oversized message before reading
  it, and core can stream the body into the HMAC check.
- **Why headers.** What is left of the envelope is a few short ASCII values,
  which is what headers are for. `meta` was a free-form map that only ever
  carried a trace id, which has a standard header.
- **One message per request.** A raw body cannot carry several messages
  without framing. Sync relay is one minion request to one core call, so
  nothing is lost; a batching transport would get a contract of its own.
- **Channel authentication** (planned, shared secret or mTLS) signs the method,
  path, the `Logos-*` headers and the body, rather than one JSON document. mTLS
  needs nothing more.
- **AMQP.** An AMQP message is also headers plus a body, so the same shape
  carries over if the data plane ever moves onto a queue.
