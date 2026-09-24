---
title: "Transposition Profile YAML Reference"
---

> **Status:** this reference describes the target spec. Individual channel implementations may not support every field yet (for example `action`) until implementation catches up.

## Canonical YAML Structure

```yaml
profile_id: 1
profile_label: generic-profile-01
enabled: true

action:
  type: sync

mapping:
  profile_id:
    target:
      location: <channel-defined-location>
      key: <profile-hint-key>
    transform:
      - type: prefix
        value: "p:"
      - type: base64url

  id:
    target:
      location: <channel-defined-location>
      key: <id-key>
    transform:
      - type: suffix
        value: "::id"
      - type: base64url

  encrypted_data_in:
    target:
      location: <channel-defined-location>
      key: <payload-in-key>
    transform:
      - type: base64

  encrypted_data_out:
    target:
      location: <channel-defined-location>
      key: <payload-out-key>
    transform:
      - type: base64

noise:
  inbound:
    - target:
        location: header
        key: X-Trace-ID
      value:
        type: uuid
    - target:
        location: query
        key: _ref
      value:
        type: alphanumeric
        length: 8
  outbound:
    - target:
        location: header
        key: X-Cache-Status
      value:
        type: choice
        values: ["HIT", "MISS", "EXPIRED"]
```

## Field Reference

Top-level:

- `profile_id` (required): int32 numeric identifier
- `profile_label` (optional): human-readable name
- `enabled` (required)
- `action` (required)
- `mapping` (required)
- `noise` (optional): decoy field definitions for traffic blending

`action`:

- `type` (required): action name
- `params` (optional): action-specific parameters

Standard actions (every channel must implement):

- `sync` — decode mapping, call Logos sync endpoint, encode response

Channels may define additional custom actions (e.g., `redirect`). Custom action names, params schema, and behavior are fully channel-defined.

`mapping`:

- `profile_id` (optional)
  - used to read/write hint
- `id` (required unless `composite_in` is used)
  - inbound only (minion -> channel -> server); outbound responses do not carry `id`
- `encrypted_data_in` (required unless `composite_in` is used)
  - inbound encrypted payload mapping (minion -> channel -> server)
- `composite_in` (optional; replaces `id` + `encrypted_data_in`)
  - single transport value carrying both `id` and `encrypted_data` concatenated together
  - requires `separator` to define how fields are split/joined
- `encrypted_data_out` (required for actions that return data)
  - outbound encrypted payload mapping (server -> channel -> minion); outbound carries only `encrypted_data`
  - may be omitted when the action does not return data to the minion (e.g., `redirect`)

Each mapping entry supports:

- `target.location`: **channel-defined location namespace** (string)
- `target.key` (optional): transport key/name; omit when the mapping targets the entire location (e.g., raw body)
- `transform[]`: ordered transform object list

`composite_in.separator`:

- `type: length_prefix` — first N bytes are `id`, rest is `encrypted_data` (`id_length` required)
- `type: delimiter` — split on character sequence (`value` required)

Supported transform types (v1):

- `base64`
- `base64url`
- `prefix` (`value` required)
- `suffix` (`value` required)
- `replace` (`from`, `to` required)
- `url_encode`

## Noise (decoy fields)

`noise` defines decoy fields injected into transport to blend Logos traffic with legitimate traffic. Noise fields carry no operational data — they exist solely to make requests and responses look more natural.

`noise`:

- `inbound[]` (optional): list of noise entries that the minion adds to requests. The channel does not process inbound noise — it only extracts fields defined in `mapping` and naturally ignores everything else.
- `outbound[]` (optional): list of noise entries that the channel injects into responses. Minion ignores these.

Each noise entry:

- `target.location`: channel-defined location namespace (same as mapping locations: `header`, `body`, `query`, `cookie`, `message`)
- `target.key`: fixed key name (string), or a generator object for random keys
- `value` (required): value generation config
- `count` (optional, default: 1): number of noise entries of this pattern to generate per request/response

Value generator types:

| Type | Parameters | Output example |
|------|-----------|----------------|
| `static` | `value: "..."` | Fixed string |
| `choice` | `values: [...]` | Random pick from list |
| `uuid` | — | `550e8400-e29b-41d4-a716-446655440000` |
| `alphanumeric` | `length: N` | `a8Kf3mZx` |
| `numeric` | `length: N` | `1647382956` |
| `hex` | `length: N` | `4a3f2b1c` |
| `timestamp_ms` | — | `1710748800000` |
| `range` | `min: N`, `max: N` | Random integer in range |

Optional modifiers on any generator: `prefix: "..."`, `suffix: "..."`.

Random key generation — when `target.key` is an object instead of a string, the key itself is generated randomly:

```yaml
noise:
  outbound:
    - target:
        location: header
        key:
          type: alphanumeric
          length: 8
          prefix: "X-"
      value:
        type: hex
        length: 32
      count: 3           # generate 3 random noise headers
```

### Direction semantics

- **Inbound noise**: minion generates and adds these decoy fields to its requests. The channel does not need to process, strip, or validate inbound noise — it only reads fields defined in `mapping` and naturally ignores everything else. Inbound noise definitions in the profile serve as a contract for the minion.
- **Outbound noise**: channel generates and injects these fields into the response. Minion ignores them on receive.
- Noise generation happens per-request (inbound: minion-side, outbound: channel-side). Each request/response gets fresh random values.

### Noise and profile matching

- Noise fields are **not** considered during profile matching — they are processed only after a profile is matched.
- Noise keys must not collide with `mapping` keys in the same location.
- Channel should validate this constraint on profile create/update.

## Action execution semantics

- Profile matching/decoding happens first.
- After a profile matches, the channel executes `action.type` with `action.params`.
- Standard actions (`sync`) have spec-defined behavior; custom actions are channel-defined.

## Transformation chain order (authoritative)

For a transform chain:

```yaml
transform:
  - type: T1
  - type: T2
  - type: T3
```

Order semantics:

- **Outbound** (`channel -> minion`): apply each transform in listed (index) order `T1 -> T2 -> T3`.
- **Inbound** (`minion -> channel`): apply the inverse of each transform in reverse index order — `T3⁻¹ -> T2⁻¹ -> T1⁻¹`.

Think of it as function composition:

- outbound value: `T3(T2(T1(canonical)))`
- inbound value: `T1^-1(T2^-1(T3^-1(received)))`

### Mini example

```yaml
transform:
  - type: prefix
    value: "chan:"
  - type: base64url
```

- outbound canonical `payload42`
  1. prefix -> `chan:payload42`
  2. base64url -> `Y2hhbjpwYXlsb2FkNDI`

- inbound received `Y2hhbjpwYXlsb2FkNDI`
  1. base64url decode -> `chan:payload42`
  2. prefix decode -> `payload42`

## Transformation examples (channel-centric direction)

### 1) `base64`

Use case: minion sends ASCII-safe payload; channel decodes to canonical value.

```yaml
transform:
  - type: base64
```

Inbound (decode in channel):
- minion sent: `Y2lwaGVyX2Jsb2I=`
- channel canonical value: `cipher_blob`

Outbound (encode in channel):
- channel canonical value: `resp:cipher_blob`
- sent to minion: `cmVzcDpjaXBoZXJfYmxvYg==`

### 2) `base64url`

Use case: minion/channel exchange data through URL-safe fields.

```yaml
transform:
  - type: base64url
```

Inbound:
- minion sent: `aGVsbG8vd29ybGQ`
- channel canonical value: `hello/world`

Outbound:
- channel canonical value: `hello/world`
- sent to minion: `aGVsbG8vd29ybGQ`

### 3) `prefix`

Use case: minion prepends marker; channel strips by decode path.

```yaml
transform:
  - type: prefix
    value: "tg:"
```

Inbound:
- minion sent: `tg:abc123`
- channel canonical value: `abc123`

Outbound:
- channel canonical value: `abc123`
- sent to minion: `tg:abc123`

### 4) `suffix`

Use case: minion appends marker; channel strips by decode path.

```yaml
transform:
  - type: suffix
    value: "::end"
```

Inbound:
- minion sent: `abc123::end`
- channel canonical value: `abc123`

Outbound:
- channel canonical value: `abc123`
- sent to minion: `abc123::end`

### 5) `replace`

Use case: minion applies character substitution; channel reverses it in decode path.

**Constraint:** `replace` is only safe when the `to` character is guaranteed not to appear in the input value. If both `from` and `to` characters can appear in the data, the inbound reversal is lossy. When applying `replace` to `encrypted_data`, always pair it with a prior encoding transform (e.g., `base64url`) that eliminates the ambiguous character first.

```yaml
transform:
  - type: replace
    from: "/"
    to: "_"
```

Inbound:
- minion sent: `a_b_c`
- channel canonical value: `a/b/c`

Outbound:
- channel canonical value: `a/b/c`
- sent to minion: `a_b_c`

### 6) `url_encode`

Use case: transport-safe payload in query/form-like fields.

```yaml
transform:
  - type: url_encode
```

Inbound (channel decode counterpart):
- minion sent: `a+b%26c%3Dd`
- channel canonical value: `a b&c=d`

Outbound:
- channel canonical value: `a b&c=d`
- sent to minion: `a+b%26c%3Dd`

## Action examples

For an extensive collection of complete profile examples with runtime walkthroughs, see [Transposition Profile Examples](../channel-transposition-examples/).

### Standard action: `sync` (HTTP channel)

```yaml
profile_id: 100
profile_label: http-sync-header
enabled: true
action:
  type: sync
mapping:
  id:
    target:
      location: header
      key: X-Request-ID
  encrypted_data_in:
    target:
      location: body
      key: data
  encrypted_data_out:
    target:
      location: body
      key: data
```

### Standard action: `sync` (Telegram channel)

```yaml
profile_id: 200
profile_label: telegram-sync-message
enabled: true
action:
  type: sync
mapping:
  id:
    target:
      location: message
      key: id
  encrypted_data_in:
    target:
      location: message
      key: payload
  encrypted_data_out:
    target:
      location: message
      key: payload
```

## Matching Model

- If `profile_id` hint resolves to one enabled profile, use it.
- Otherwise, brute-force enabled profiles ordered by runtime match frequency.
- If no profile matches, reject request as unmatched.
- On successful match:
  - `action` is resolved and executed first.
  - Inbound decode path uses `id` + `encrypted_data_in` field mappings (or `composite_in` when fields are concatenated).
  - Outbound encode path uses `encrypted_data_out` mapping only (outbound responses do not carry `id`).
  - Channel should validate that `encrypted_data_out` mapping locations are compatible with its transport capabilities (e.g., HTTP channel should reject `location: query` for `encrypted_data_out` since responses do not carry query parameters).

## Validation Constraints

For enabled profile sets in same channel scope:

- no duplicate `profile_id` values
- no overlapping enabled `mapping.profile_id` hint keys
- no overlapping enabled mapping shapes (`mapping.id` + `mapping.encrypted_data_in`)
- use unique hint design to minimize ambiguity
- noise keys must not collide with mapping keys in the same location

## Minimal Practical Example

```yaml
profile_id: 1
enabled: true
action:
  type: sync
mapping:
  id:
    target:
      location: body
      key: id
  encrypted_data_in:
    target:
      location: body
      key: encrypted_data
  encrypted_data_out:
    target:
      location: body
      key: encrypted_data
```
