---
title: "Channel Message Flow"
---

This page documents the **channel-to-core data-plane flow** — how a minion's
traffic reaches core and how core's response gets back.

## Envelope-Centric View

The core Server defines one contract surface for all channel modules: a pair of
canonical JSON envelopes exchanged over HTTP. How a channel module receives
traffic from a minion, what transport it uses, and how it extracts or embeds
fields is **the channel's concern and out of scope for core**.

Core sees only:

1. An `inbound.minion_message` envelope arriving at `POST /api/channel/sync`.
2. An `outbound.minion_message` envelope returned in the HTTP response.

```mermaid
sequenceDiagram
    autonumber
    participant I as Minion
    participant CH as Channel Module
    participant CS as Core Server

    I->>CH: transport-specific traffic
    CH->>CH: extract id + encrypted_data (channel's logic)
    CH->>CS: POST /api/channel/sync (inbound.minion_message)
    CS-->>CH: HTTP 200 (outbound.minion_message), or 400 / 403 / 503
    CH->>CH: embed encrypted_data into transport response (channel's logic)
    CH-->>I: transport-specific response
```

## What Core Requires

A well-formed `inbound.minion_message` with:

- `id` — the minion's id: its build's `minion_id`.
- `encrypted_data` — opaque blob, never inspected by the channel.
- `source.module_instance` — the channel instance sending it, which must be
  registered and not blocked (403 otherwise; 503 when core cannot read its
  registry). The id is the channel's word: there is no authentication yet.
- Standard envelope fields (`message_id`, `type`, `version`, `timestamp`).
  Core checks `type`, and that `timestamp` is RFC 3339; it does not check
  `version`. A malformed request gets 400.

Core answers a `message_id` it has seen within 24 hours with a no-op.

See [Channel ↔ Core: HTTP Sync](../contracts/channel-core-sync/) for the full
envelope schema.

## What Core Returns

An `outbound.minion_message` with:

- The same `id` for correlation.
- `encrypted_data` — opaque response blob (or empty/no-op when nothing is pending).
  Today it is always empty: core holds no minion keys and has no tasking to
  send yet.
- `meta`: `status: "ok"`, and the request's `trace_id` when it had one.

## Channel Boundaries

- Channel does **not** decrypt payload plaintext.
- Channel does **not** execute core business logic.
- Channel does **not** own factory semantics.
- How a channel maps transport fields to/from the canonical envelope is an
  implementation detail invisible to core.
