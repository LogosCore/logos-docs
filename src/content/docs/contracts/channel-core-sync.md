---
title: "Channel ↔ Core: HTTP Sync"
---

The sync call is how a channel hands core a message a minion started, and
takes back core's reply: one HTTP request per message, for the
`reverse-call` kind. It is one of a channel's [three
paths](../channel-core-connections/#three-paths) to core; persistent
connections and the `bind` kinds go over WebSockets. The minion's
ciphertext travels as the raw request body, byte for byte, and the few
values around it are headers. Core answers the same way.

How a channel module receives traffic from a minion, what transport it
uses, and how it takes the id and the ciphertext out of it is the channel's
concern and outside this contract ([Writing a
Channel](../../guides/writing-a-channel/) shows one).

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
| `Logos-Message-Id` | yes | A UUIDv4, new for every request (`protocol.NewID`): it names the request in logs. Core keeps nothing by it: a request sent again is the minion's message sent again, which core knows by the minion's own message id inside the ciphertext (step 4). |
| `Logos-Build-Id` | yes | The id the message is sent under, as a lowercase UUID: the build's, the temporary id staging gave the minion, or its session's. The header's name is older than sessions; it carries any of the three. |
| `Logos-Channel-Instance` | yes | The sending channel's registered instance id, for the registration gate. At most 128 characters. |
| `Logos-Peer-Address` | no | The IP address the channel got the message from, when its transport has one: the minion's host as the channel's network sees it (its NAT's outside address, say), or the client a proxy the channel trusts forwarded for. The channel's observation, not the minion's claim. Core keeps it as the session's external address, with the history of every one it was seen from; anything that is not an IP address is ignored. |
| `traceparent` | no | [W3C Trace Context](https://www.w3.org/TR/trace-context/). Core returns it on the reply; an invalid one is ignored. |

Header names are case-insensitive, as in all of HTTP.

## Core-side checks

In this order, so core reads no body for a request it will refuse:

1. **Headers.** `Content-Type` → **415**; a missing or malformed header →
   **400**. Both ids must be lowercase UUIDs. An invalid `traceparent` is
   ignored, and so is a `Logos-Peer-Address` that is not an IP address.
2. **Registration gate.** `Logos-Channel-Instance` must be an instance in
   status `registered`, via the [Module Lifecycle](../module-lifecycle/)
   contract, of any module type. An unknown, deregistered, dead or blocked
   instance → **403**. Registry unavailable → **503** (fails closed). Core
   caches a positive answer for one heartbeat interval, and drops it at once
   when the instance deregisters, is declared dead, blocked or deleted.
3. **Size.** A `Content-Length` over the limit → **413** before the body is
   read; a body without one is cut off at the limit, also **413**. A body
   that does not read, or an empty one → **400**.
4. **The minion's message.** Core opens the ciphertext ([Minion
   Messages](../minion-messages/)). One it cannot open, or that is not a
   message core takes here (an answer, with `re`, never comes through the
   sync call) → **422**. Core knows a message by the minion's own message
   id, sealed inside it ([Freshness and
   replay](../minion-messages/wire-format/#freshness-and-replay)), never by
   `Logos-Message-Id`. A message whose id core has seen gets the reply it got
   the first time, while core keeps that reply (10 minutes, for a reply of
   at most 64 KiB; **204** again when core had nothing to say), and nothing
   in it runs twice: a channel retrying a request it is unsure of, or a
   minion sending again a request whose reply did not come, gets what was
   lost. Past that, within the 24 hours core remembers message ids, it is a
   replay → **409**. With core's cache unavailable, every message is
   handled.
5. **Handling.** Core takes the message's items and makes its reply. A
   failure of core's own (its store) → **500**.

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
| **200** | The body is core's reply: ciphertext for the minion. |
| **204** | Core has nothing for the minion. |
| **400** | A header missing or malformed, a body that does not read, or an empty body. |
| **403** | `Logos-Channel-Instance` is not a registered instance: unknown, deregistered, dead or blocked. |
| **409** | A replay: core saw the minion's message before and no longer keeps its reply. |
| **413** | The body is over the size limit. |
| **415** | The body is not `application/octet-stream`. |
| **422** | The minion's message does not open, or is not one core takes through the sync call. |
| **500** | Core failed while handling a message that opened. |
| **503** | Core cannot read its module registry: the gate fails closed. |

Both success replies carry `Logos-Message-Id` (core's own, a UUIDv4) and
`Logos-Build-Id` (the request's), and `traceparent` when the request had one.
Every error has a JSON body, `{"error": "…"}` with `Content-Type:
application/json`, so a channel tells a reply from an error by the status
code. A channel checks that `Logos-Build-Id` is the one it sent, and relays a
200 body to the minion unchanged.

Core answers **200** when it has something for the minion (a stage's or a
hello's reply, tasks, acks, cancels) and **204** when it has nothing.
Channels relay a 204 as their transport says "nothing": the HTTP channel
answers the minion with the packed id alone, the TCP channel with a frame of
the id alone.

**Every other answer is a failure** to the minion: the channel answers its
client as it answers any failure (the HTTP channel a plain 404, the TCP
channel by closing the connection without a reply), so neither the minion
nor a stranger learns anything from a 403, a 409 or a 422. The channel logs
the status.

## Processing semantics

- One minion message per HTTP request, one reply per response.
- Core opens the minion's message and seals its reply ([payload
  crypto](../minion-messages/wire-format/)); the channel never does.
- **The handling is core's own**: a channel that stops waiting (its request
  timed out, its client went away) does not cut it short. It goes on for up
  to 2 minutes, and the minion's message sent again gets its reply.
- A channel may send a request again when it does not know whether core
  got it: nothing in it runs twice, and within 10 minutes it gets the reply
  core gave (a reply of at most 64 KiB; past that size, or that time, a
  409).

## Go SDKs

- `logos-golang-protocol`: `InboundMinionMessage` and `OutboundMinionMessage`
  (the ids, the optional `TraceParent` and `PeerAddress`, and `Data
  []byte`), `SetHeaders`, `InboundFromHeaders` / `OutboundFromHeaders`, the
  header names and `SyncPath`, `NewID`, and `ValidateInbound` /
  `ValidateInboundHeaders` / `ValidateOutbound`.
- `logos-golang-channel-core`: `syncclient.HTTPClient` makes the call (its
  `Client` defaults to module-core's `coretls` client, which trusts core's
  certificate as the [`LOGOS_CORE_*`
  settings](../../core-infrastructure/#how-modules-reach-core) say);
  `syncclient.ReadReply` reads core's reply for a channel with its own HTTP
  client. Both return an error for any status but 200 and 204, check that
  the reply's `Logos-Build-Id` is the one sent, and cap the reply (16 MiB by
  default).

## Design notes

- **Why a raw body.** The ciphertext is bytes, and JSON has no type for
  them: a JSON body would carry them as a base64 string, a third more on the
  channel ↔ core hop and several copies of each payload on both sides. With
  a raw body there is no conversion to get wrong, `Content-Length` lets core
  refuse an oversized message before reading it, and core can stream the
  body into the HMAC check.
- **Why headers.** What goes with the ciphertext is a few short ASCII
  values, which is what headers are for, and a trace id has a standard one.
- **Why the minion's message id, not the request's.** A request id is the
  channel's: a retry, or the minion sending again, would come under a new
  one. The minion's message id is sealed with the message, so only a holder
  of its keys makes one, and the same message is the same id whichever
  request carries it.
- **One message per request.** A raw body cannot carry several messages
  without framing. Sync relay is one minion request to one core call, so
  nothing is lost; a batching transport would get a contract of its own.
- **Channel authentication** (planned, shared secret or mTLS) signs the
  method, path, the `Logos-*` headers and the body. mTLS needs nothing more.
- **AMQP.** An AMQP message is also headers plus a body, so the same shape
  carries over if the data plane ever moves onto a queue.
