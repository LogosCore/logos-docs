---
title: "Message Flow (Full System)"
---

End-to-end flow across all major components.

## End-to-End Sequence

```mermaid
sequenceDiagram
    autonumber
    participant I as Minion
    participant CH as Channel Module
    participant CS as Core Server (Key Owner)
    participant IP as Minion Factory

    I->>CH: transport traffic (channel-specific)
    CH->>CS: POST /api/channel/sync (inbound.minion_message)
    CS->>CS: Resolve context/key from id
    CS->>CS: Decrypt + verify payload
    CS->>IP: Parse factory response into normalized Logos event
    IP-->>CS: Normalized Logos event
    CS->>CS: Persist/audit/update state

    CS->>IP: Build outbound payload for id (if any)
    IP-->>CS: Factory plaintext payload
    CS->>CS: Encrypt outbound payload (or no-op envelope)
    CS-->>CH: HTTP 200 outbound.minion_message (encrypted_data)
    CH-->>I: transport response (channel-specific)
```

## Notes

- `minion ↔ core Server` is the logical protocol conversation.
- Channel is a transport relay — it delivers canonical envelopes and remains plaintext-blind.
- Minion Factory is an internal core-side processing layer.
- How a channel extracts `id` + `encrypted_data` from its transport, or embeds
  the response back, is the channel's implementation detail. Core only sees the
  canonical envelopes defined in [Channel ↔ Core: HTTP Sync](./contracts/channel-core-sync/).
