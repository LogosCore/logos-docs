---
title: "Channel Message Flow (Isolated)"
---

This page documents **channel-only** flow and responsibilities.

It intentionally excludes internal core processing layers such as minion factories.

## Channel-Centric Sequence

```mermaid
sequenceDiagram
    autonumber
    participant I as Minion
    participant CH as Channel Module
    participant CS as Core Server

    I->>CH: transport message (transpositioned id + encrypted_data)
    CH->>CH: resolve profile (hint -> brute-force enabled profiles)
    CH->>CH: de-transpose to canonical id + encrypted_data
    CH->>CS: POST /api/channel/sync (inbound.minion_message)
    CS-->>CH: HTTP 200 outbound.minion_message (encrypted_data)
    CH->>CH: re-transpose response by active profile
    CH-->>I: transport response (transpositioned id + encrypted_data)
```

## Channel Responsibilities

- Transport adaptation (HTTP/Telegram/etc.).
- Transposition profile resolution and mapping.
- Canonicalization to `id` + `encrypted_data`.
- Forwarding canonical request to core sync endpoint.
- Returning core response to minion in transport form.

## Channel Boundaries

- Channel does **not** decrypt payload plaintext.
- Channel does **not** execute core business logic.
- Channel does **not** own minion-factory semantics.
