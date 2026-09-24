---
title: "Channel Transposition Profiles"
---

This page defines the transposition layer used by channel modules when transporting `id` (inbound) and `encrypted_data` (both directions) for minion communication with core Logos.

## Purpose

Transposition profiles are a transport-shaping layer on top of the base sync contract. They do **not** replace app-level minion↔Server encryption.

- App-level encryption (`encrypted_data`) remains mandatory.
- Transposition controls how `id` and `encrypted_data` are embedded in channel transport fields.

## What a profile can control

A profile may define where and how fields are placed, for example:

- HTTP headers
- query parameters
- cookies
- body fields
- mixed placement (split across multiple locations)

A profile may also define noise fields — extra headers, query parameters, body fields, or cookies that carry no operational data.

In addition to `id` and `encrypted_data`, transport may carry `profile_id` hint used for fast profile selection.
A profile may also define reversible encoding/wrapping, for example:

- base64/base64url variants
- field renaming/aliasing
- optional channel-layer wrapping/encryption

A profile also defines channel behavior through an `action` object — `action.type` selects behavior after profile match and canonical decode, `action.params` carries channel-defined parameters. See the [YAML Reference](../channel-transposition-yaml-reference/) for exact structure.

> **Status:** documentation-level specification (design target). Runtime implementation may lag behind spec.

## Profile storage and ownership

- Profiles are stored as YAML files on the channel module's local disk.
- Persistence across restarts/redeploys uses Docker volumes mounted at the
  channel's profile directory — there is no central profile database.
- Channel module owns runtime loading, validation, and execution of profiles,
  and is the system-of-record for them.
- Core Logos owns management UX/API and policy decisions, driven over the
  [profile RPC contract](../contracts/channel-core-rpc/).

## YAML Specification

YAML schema details are intentionally kept in a dedicated page:

- [Transposition Profile YAML Reference](../channel-transposition-yaml-reference/)
- [Transposition Profile Examples](../channel-transposition-examples/)

Use this page for architecture/behavioral concepts and matching model.
Use the YAML reference page for exact profile file structure, field-level syntax, and transform catalog.
Use the examples page for a self-contained walkthrough and ready-to-use profile catalog.

## Runtime flow

Inbound (minion -> channel -> core):

1. Channel receives transposed transport payload.
2. Channel first attempts to extract `profile_id` hint using configured hint locations.
3. If hint is valid and points to enabled profile, channel uses that profile directly.
4. If hint is missing/invalid, channel builds candidate list from enabled profiles.
5. Channel tries candidates ordered by runtime match frequency.
6. On first successful decode to canonical fields (`id`, `encrypted_data`), channel uses that profile.
7. If no candidate succeeds, channel rejects request as unmatched profile.
8. After profile match, channel resolves and executes `action` from that profile. Any inbound noise fields added by the minion are naturally ignored — the channel only reads fields defined in `mapping`.
9. For process-style actions, channel sends canonical request to Server sync endpoint after successful action resolution.

Outbound (core -> channel -> minion):

1. Channel receives canonical response (`outbound.minion_message`) containing only `encrypted_data`.
2. Channel uses the inbound-resolved profile and `encrypted_data_out` mapping to produce outbound transport payload. Outbound does not carry `id`.
3. Channel injects outbound noise fields (if defined) into the transport response.
4. Channel returns transport-shaped response to minion.
5. Channel updates profile usage counters/cache for future ordering.

## Action examples

Standard actions (every channel must implement):

- `sync` — decode profile mapping, call Logos sync endpoint, encode response.

Custom actions (channel-defined, examples):

- `proxy-pass` (HTTP) — implements proxy pass behavior to alternate channel infrastructure instead of local sync processing.

See [Transposition Profile YAML Reference](../channel-transposition-yaml-reference/) for full profile examples with action configuration.

## Management model

Channel modules expose RabbitMQ RPC management endpoints so core can manage profiles.

### Example RPC actions

- `transposition.profile.list`
- `transposition.profile.get`
- `transposition.profile.create`
- `transposition.profile.update`
- `transposition.profile.delete`
- `transposition.profile.activate`
- `transposition.profile.validate`
- `transposition.profile.simulate_match`
- `transposition.profile.stats`

Validation on create/update should include overlap checks against other enabled profiles for the same channel.

## Matching conflict and performance strategy

### Conflict control

- Multiple enabled profiles may accidentally match the same inbound shape.
- Channel/Logos must reject create/update operations that introduce ambiguous overlap (for same channel).
- `profile_id` hint must uniquely map to one enabled profile in channel scope.
- Default profile behavior is not supported; unmatched payloads must be rejected.

### Performance control

- Prefer direct selection via transport `profile_id` hint.
- Order attempts by observed frequency/success rate.
- Cache source-to-profile affinity (for example `source_ip -> profile_id`, `telegram_chat_id -> profile_id`) with TTL.
- On cache hit, try cached profile first; on miss/failure, continue ordered candidates.

## Security boundaries

- Transposition is not a substitute for cryptography.
- Channel must stay plaintext-blind for minion business semantics.
- Profile logic must not require decrypting `encrypted_data`.
- Changes to active profile should be auditable (who/when/what changed).
