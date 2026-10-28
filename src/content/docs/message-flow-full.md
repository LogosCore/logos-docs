---
title: "Message Flow (Full System)"
---

End-to-end flows across the major components: how a minion comes to exist,
what happens to its traffic today, and where the design takes it.

## A Minion Is Built

An operator builds a minion in an operation; a factory instance builds it. The
build's `minion_id` is the minion's `id` on the data plane from then on.

```mermaid
sequenceDiagram
    autonumber
    participant OP as Operator
    participant CS as Core Server
    participant IP as Factory instance
    participant S3 as SeaweedFS

    OP->>CS: build (factory, target, platform, values, commands, connections)
    CS->>CS: validate against the factory's build schema, new minion id → QUEUED
    CS->>IP: factory.build (AMQP, the instance's rpc_queue)
    IP-->>CS: accepted, with the build's plan → BUILDING
    IP->>S3: download build files (presigned URLs)
    IP->>CS: factory.build.progress (logos.core.rpc)
    IP->>S3: upload the artifact (presigned URL)
    IP->>CS: factory.build.result
    CS->>S3: check the artifact's size and SHA-256
    CS->>CS: SUCCEEDED: the minion is recorded
```

Every channel the minion is built to reach has registered with core already:
its connection settings follow the channel's
[minion connection schema](../contracts/minion-connection/). See
[Minion Build](../contracts/minion-build/).

## The Minion's Traffic Today

```mermaid
sequenceDiagram
    autonumber
    participant I as Minion
    participant CH as Channel Module
    participant CS as Core Server

    I->>CH: transport traffic (channel-specific)
    CH->>CS: POST /api/channel/sync (inbound.minion_message)
    CS->>CS: check the envelope's fields
    CS->>CS: registration gate: the channel instance registered, not blocked
    CS->>CS: de-duplicate by message_id
    CS-->>CH: HTTP 200 outbound.minion_message (encrypted_data empty)
    CH-->>I: transport response (channel-specific)
```

Core does not look at the payload yet: it holds no minion keys, and there is
no tasking to send. Every valid message gets an empty reply. See
[Channel ↔ Core: HTTP Sync](../contracts/channel-core-sync/).

## The Target

Once payload crypto and the factory command contract are written, core opens
each message and answers with the minion's pending tasks:

```mermaid
sequenceDiagram
    autonumber
    participant I as Minion
    participant CH as Channel Module
    participant CS as Core Server (Key Owner)
    participant IP as Factory

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
- Factories are separate processes. Today they talk to core only about builds,
  over AMQP, and to the object store through presigned URLs. In the target they
  also translate between the minion's language and Logos events, on plaintext
  core gives them.
- How a channel extracts `id` + `encrypted_data` from its transport, or embeds
  the response back, is the channel's implementation detail. Core only sees the
  canonical envelopes defined in [Channel ↔ Core: HTTP Sync](../contracts/channel-core-sync/).
