---
title: "Channel ↔ Core: HTTP Sync"
---

This is the **data-plane** contract between a channel module and the core
Server: one HTTP call per minion message. The minion's ciphertext travels as
the raw request body, byte for byte, and the few fields around it are
headers. Core answers the same way.

How a channel module receives traffic from a minion, what transport protocol it
uses, and how it extracts or embeds the build id and the ciphertext is
entirely the channel's concern and outside this contract.

The endpoint sits outside core's operator API (`/api/v1`): no session, no CSRF
token. Nothing authenticates the channel yet; core admits a request by the
instance id the channel asserts (the registration gate, below). nginx forwards
it with the rest of `/api/`.

## Request

```http
POST /api/channel/sync
Content-Type: application/octet-stream
Content-Length: 1048698
Logos-Message-Id: c4ca4238-a0b9-4382-8dcc-509a6f75849b
Logos-Build-Id: 550e8400-e29b-41d4-a716-446655440000
Logos-Channel-Instance: http-main
Logos-Peer-Address: 203.0.113.7
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01

<ciphertext bytes>
```

| Part | Required | Meaning |
|---|---|---|
| `Content-Type` | yes | `application/octet-stream`. Anything else → **415**. |
| Body | yes | The minion's ciphertext, as the minion sent it once the channel has undone its own transport encoding. Not empty. At most `CHANNEL_SYNC_MAX_SIZE` (a core setting, default 16 MiB). |
| `Logos-Message-Id` | yes | Unique per request, a UUIDv4. Core dedups on it. |
| `Logos-Build-Id` | yes | The id of the build that made the minion, as a lowercase UUID. |
| `Logos-Channel-Instance` | yes | The sending channel's registered instance id, for the registration gate. |
| `Logos-Peer-Address` | no | The IP address the channel got the message from, when its transport has one: the minion's host as the channel's network sees it (its NAT's outside address, say), or the client a proxy the channel trusts forwarded for. The channel's observation, not the minion's claim. Core keeps it as the session's external address, with the history of every one it was seen from; anything that is not an IP address is ignored. |
| `traceparent` | no | [W3C Trace Context](https://www.w3.org/TR/trace-context/). Core returns it on the reply; an invalid one is ignored. |

Header names are case-insensitive, as in all of HTTP.

## Core-side checks

In this order, so core reads no body for a request it will refuse:

1. `Content-Type` → **415**; a missing or malformed header → **400**. Both
   ids must be lowercase UUIDs. An invalid `traceparent` is ignored.
2. **Registration gate** — `Logos-Channel-Instance` must be an instance in
   status `registered`, via the [Module Lifecycle](../module-lifecycle/)
   contract, of any module type. An unknown, deregistered, dead or blocked
   instance → **403**. Registry unavailable → **503** (fails closed). Core
   caches a positive answer for one heartbeat interval, and drops it at once
   when the instance deregisters, is declared dead, blocked or deleted.
3. **Size** — a `Content-Length` over the limit → **413** before the body is
   read; a body without one is cut off at the limit, also **413**. An empty
   body → **400**.
4. **Idempotency** — `Logos-Message-Id` is deduped via `SetNX` with a 24-hour
   window. A replay of an already-seen id gets the same no-op answer (**204**),
   not an error: a channel retrying a request it is unsure of. The dedup
   fails open: with the cache disabled or failing, every message is
   processed.
5. **The minion's message** — core opens the ciphertext ([Minion
   Messages](../minion-messages/)). One it cannot open → **422**; one whose
   own message id core has seen (a captured message sent again) → **409**.
   A channel answers its client for both as for any failure, so a stranger
   learns nothing from them.

## Response

```http
HTTP/1.1 200 OK                          HTTP/1.1 204 No Content
Content-Type: application/octet-stream   Logos-Message-Id: 3c9d2b7e-…
Logos-Message-Id: 3c9d2b7e-…             Logos-Build-Id: 550e8400-…
Logos-Build-Id: 550e8400-…
                                         (nothing for the minion)
<ciphertext bytes>
```

| Code | Meaning |
|---|---|
| **200** | The body is ciphertext for the minion. |
| **204** | Nothing for the minion. |
| **400** | A header missing or malformed, or an empty body. |
| **403** | `Logos-Channel-Instance` is not a registered instance. |
| **409** | The minion's message was seen before: a replay. |
| **413** | The body is over the size limit. |
| **415** | The body is not `application/octet-stream`. |
| **422** | The minion's message does not open. |
| **503** | The registration gate is unavailable (fails closed). |

Both success replies carry `Logos-Message-Id` (core's own, a UUIDv4) and
`Logos-Build-Id` (the request's), and `traceparent` when the request had one.
Every error has a JSON body, `{"error": "…"}` with `Content-Type:
application/json`, so a channel tells a reply from an error by the status
code. A channel checks that `Logos-Build-Id` is the one it sent, and relays a
200 body to the minion unchanged.

Core holds no tasking yet, so today it answers every valid request with
**204**. Channels relay that like any other reply: `logos-http-channel`
answers the minion with the packed id alone.

## Processing semantics

- One minion message per HTTP request, one reply per response.
- Core decrypts inbound and encrypts outbound (planned, with the payload
  crypto contract). Channel never decrypts.
- Channel relays a 200 body to the minion unchanged.

## Go SDKs

- `logos-golang-protocol`: `InboundMinionMessage` and `OutboundMinionMessage`
  (the ids, the optional `TraceParent`, and `Data []byte`), `SetHeaders`,
  `InboundFromHeaders` / `OutboundFromHeaders`, the header names and
  `SyncPath`, and `ValidateInbound` / `ValidateInboundHeaders` /
  `ValidateOutbound`.
- `logos-golang-channel-core`: `syncclient.HTTPClient` makes the call;
  `syncclient.ReadReply` reads core's reply for a channel with its own HTTP
  client. Both check that the reply names the same minion, and cap the reply
  (16 MiB by default).

## From the JSON envelope

Until this contract, the call was a JSON envelope (`inbound.minion_message` /
`outbound.minion_message`) with the ciphertext as a base64 string:

| JSON envelope | Raw body |
|---|---|
| `encrypted_data` (base64 by convention) | The body |
| `encrypted_data: ""` in a reply | **204 No Content** |
| `message_id` | `Logos-Message-Id` |
| `id` | `Logos-Build-Id` |
| `source.module_instance` | `Logos-Channel-Instance` |
| `meta.trace_id` | `traceparent` |
| `type`, `version`, `timestamp`, `source.module`, `source.transport`, `source.tenant`, `meta.status` | Dropped: the endpoint and the status code say what they said, core stamps its own receive time, and the rest were constant. |

## Design notes

- **Why a raw body.** The ciphertext is bytes and JSON has no type for them,
  so the envelope carried them as a base64 string. That costs a third more on
  the channel ↔ core hop and three or four copies of each payload (the body,
  the JSON string, the decoded bytes) on both sides. Nothing specified the
  encoding either: `logos-http-channel` sent base64, while channel-core's
  profile runtime sent whatever its transforms decoded to. Raw bytes from such
  a profile did not even survive the trip, since Go's JSON encoder replaces
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
