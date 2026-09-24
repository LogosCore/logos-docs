---
title: "Message Flow (Full System)"
---

This page documents the end-to-end flow across all major components:

- Minion
- Channel Module
- Core Server
- Minion Factory Module

## End-to-End Sequence

```mermaid
sequenceDiagram
    autonumber
    participant I as Minion
    participant CH as Channel Module
    participant CS as Core Server (Key Owner)
    participant IP as Minion Factory

    I->>CH: id + encrypted_data (beacon/result/check-in)
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
    CH-->>I: Return encrypted response payload
```

## Notes

- `minion ↔ core Logos` is the logical protocol conversation.
- Channel is a transport relay and remains plaintext-blind.
- Minion Factory is an internal core-side processing layer.
