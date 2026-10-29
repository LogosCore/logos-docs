---
title: "Minion Connection Schema"
---

Every minion reaches core through at least one channel. What a minion needs to
know to reach a channel depends on the channel's kind: an HTTP channel needs a
base URL and TLS settings, a DNS channel would need a domain and resolvers. So
**each channel declares the parameters itself**, as a **minion connection
schema** sent at [registration](../module-lifecycle/#moduleregister). Core
stores it, and each operation keeps **channel endpoints**: ready-to-use values
for it that its operators reuse when creating minions.

```mermaid
flowchart LR
    CH[Channel instance] -- "module.register: connection schema" --> CORE[Core]
    OP[Operator] -- "endpoints of an operation" --> CORE
    CORE -- "validates against the schema" --> CORE
    CORE -- "values copied in" --> MIN[Minion settings]
    MIN -. "connects with the values" .-> CH
```

The channel only provides the schema. It never sees endpoints, and nothing
depends on them: a minion gets its own copy of the values, so changing or
deleting an endpoint changes nothing already configured.

## The schema

Declared in `module.register` under `connection`:

```json
{
  "schema_version": "1",
  "version": 2,
  "fields": [
    {
      "key": "base_url", "type": "url", "label": "Base URL", "required": true,
      "pattern": "^https?://[^/?#\\s]+$", "max_length": 2048, "group": "Address", "order": 1
    },
    { "key": "tls_verify", "type": "bool", "default": false, "group": "TLS", "order": 6 },
    { "key": "request_timeout", "type": "duration", "default": "40s", "min": "1s", "max": "10m", "group": "Timing", "order": 10 }
  ]
}
```

| Field | Meaning |
|---|---|
| `schema_version` | Format of this structure: `"1"`. |
| `version` | Version of the channel's parameter set, from 1. Raised when minions built against the previous set would read the new one wrongly: a field removed, renamed or given another meaning. Adding an optional field does not need it. |
| `fields[]` | 1 to 32, with unique keys, each a field spec exactly as in a [management manifest](../module-management/#fields): `key`, `type`, label, description, group, order, required, default, bounds, pattern, options. `file` is not allowed. |

Core validates the schema at registration (structure, limits, defaults against
their own specs) and refuses a registration whose schema is invalid. A
registration without `connection` clears the stored one.

The schema belongs to the **channel kind** (`module_name`): every instance of a
kind is expected to declare the same one for a given `version`, so it must not
depend on one instance's settings. Core stores it with each registration and
uses the kind's **latest** schema: the highest `version` any instance declared,
from its most recent registration. Deregistered, dead and blocked instances
count until an operator deletes them, so after a downgrade the newer schema
stays current.

The schema describes **what a minion is given**, not how the channel runs. The
channel's own settings are its [management properties](../module-management/).

## Channel endpoints

An endpoint is a ready-to-use set of values for a channel kind's schema,
typically one per address minions use: direct, through a CDN, through a
regional front. Endpoints belong to an **operation**: each operation has its
own set, shared by its members. Within it, an endpoint belongs to a channel
kind, not to an instance, because one address often fronts several instances
and instances come and go.

| Property | Meaning |
|---|---|
| `id` | The endpoint's id (a UUID). |
| `operation_id` | The operation that owns it. |
| `name` | What operators call it: any text on one line, at most 120 characters. Need not be unique. |
| `slug` | The endpoint's identifier, unique within the operation (`^[a-z0-9][a-z0-9._-]{0,62}$`): what an export, a build's connection and a download's file name carry. Made from the name when not given (lowercased, other characters as `-`: "Edge EU (CDN)" is `edge-eu-cdn`), the next free one when that is taken; kept when the name changes. |
| `description` | Optional, at most 500 characters: what the endpoint is for. Searched; never part of the export. |
| `module_name` | The channel kind whose schema the values follow (e.g. `http`). |
| `values` | By field key. A field without a value uses the schema's default. |
| `schema_version` | The schema `version` the values were saved against. |
| `revision` | Grows with every change; an update must name the revision it read (otherwise `CONFLICT`). |
| created and updated by and at | Who made and last changed it, and when. |

Values are validated with the same rules as management properties: type,
bounds, pattern, required, and **no undeclared keys**. Validation runs when an
endpoint is saved and again whenever it is read or exported, against the kind's
**latest** schema, because a new channel release may declare a different one.
An endpoint that no longer fits shows its problems and **cannot be used** until
it is fixed. One saved against another schema `version` than the kind's current
one is flagged ("Saved for vN") but stays usable while its values fit; saving
it again records the current version.

The API stores the values it is sent, leaving out only `null`, `""` and empty
lists or maps; the app's form also leaves out values equal to the field's
default, so those keep following the default.

The list is paged (20 at a time) and sorted by name, case aside. Its search runs
in core: a substring, case aside, or "quotes" for whole words, over the name,
slug, description, kind and the values. It can also be narrowed to channel kinds.
The GraphQL operations: `channelKinds`, `channelEndpoints`, `channelEndpoint`,
`channelEndpointExport`, `freeChannelEndpointSlug`, and
`createChannelEndpoint`, `updateChannelEndpoint`, `deleteChannelEndpoint`.

Endpoint values are operation data and are shown to members as they are,
`secret` fields included.

| Who | Can |
|---|---|
| Viewer of the operation | list endpoints and get their resolved settings |
| Operator or admin of the operation | also create, change and delete them |
| App admin | the same in every operation, member or not |
| Agent API key | nothing today: agent keys reach core only through MCP, which has no endpoint tools |

In the Public operation every signed-in user counts as an operator.

Members also see every channel kind with its current schema (kind, version,
fields and its icon; nothing about instances), which the endpoint form is built
from, and so is each connection of a [build](../minion-build/#connections): a
connection can be filled in from an endpoint, or saved as a new one, each a
copy of the values.
Deleting an operation deletes its endpoints.

## The export

The endpoint as a minion's connection settings: its values over the schema's
defaults, so a minion needs no knowledge of the schema itself. A field with
neither a value nor a default is left out, and `channel.schema_version` is the
kind's current version. An endpoint with problems cannot be exported: the API
answers `BAD_USER_INPUT` with the problems, and the app disables Copy and
Download as JSON (a download is named `<slug>.endpoint.json`). The export's
`name` is the endpoint's slug: what factories and minions call the
connection; the operators' name for it stays in core, like the description.

A build's connections reach the factory in this format too: each one as the
`endpoint` of a `factory.build` connection, named after the connection
(`<channel>-<n>` when it has no name), next to the factory's own `values` for
it ([Minion Build](../minion-build/#factorybuild)).

```json
{
  "format": "logos.channel-endpoint.v1",
  "name": "edge-eu",
  "channel": { "module_name": "http", "schema_version": 2 },
  "params": {
    "base_url": "https://edge-eu.example.com",
    "tls_verify": false,
    "request_timeout": "40s",
    "checkin_interval": "60s",
    "checkin_jitter": 20,
    "ws_reconnect_backoff": "60s"
  }
}
```

The app also takes this format back: **Import** on the Endpoints page opens a
new endpoint's form filled in from an export, pasted or from a file, to check
before saving. The export's `name` becomes the endpoint's name (an export
without one gives `imported`), and its slug is made when it is saved; values
equal to the kind's
current defaults are dropped so those fields keep following the defaults, keys
the kind does not declare are left out (and named), and an export for another
schema `version` is pointed out. An export has no description, so an imported
endpoint starts without one.

**Duplicate** opens a new endpoint's form with an existing endpoint's stored
values and description, named `<name> (copy)`; it gets a slug of its own when
saved.

The endpoint form has **Form** and **JSON** tabs. The JSON tab edits the export's
shape plus the `slug` and the `description` (its `name` is the endpoint's name
there, any text), lists every field with its default, takes `null` to reset a
field, and locks `format` and `channel`.

A minion that can speak several channel kinds gets an **ordered list** of
connection settings and falls back through it. Every connection must be through
a channel kind and connection schema version the build's target supports, or
the build is refused; a build needs at least one. Creating minions with these
settings is the factory's job: see [Minion Build](../minion-build/).

## HTTP channel, version 2

| Key | Type | Default | Notes |
|---|---|---|---|
| `base_url` | url | required | `http(s)://host[:port]`, **no path**: the channel accepts any path, the minion picks its own. At most 2048 characters. |
| `extra_base_urls` | string_list | — | More addresses of the channel in the same form (e.g. other fronts), at most 16. A minion falls back to them, in order, when the base URL cannot be reached; the other parameters apply to each. |
| `host_header` | string | — | `Host` to send when it must differ from the base URL's host (CDN, reverse proxy). At most 255 characters. |
| `sni` | string | — | TLS server name, when it must differ. At most 255 characters. |
| `proxy` | url | — | Outbound proxy for the minion. |
| `tls_verify` | bool | `false` | Check the certificate against trusted roots. |
| `tls_pin_sha256` | string | — | SHA-256 of the server certificate (64 hex); authenticates the server with verification off. |
| `user_agent` | string (`format: user_agent`) | — | Empty: the minion's built-in one. The UI offers a generator for realistic browser User-Agents. At most 512 characters. |
| `headers` | string_map | — | Extra headers on every request and WebSocket handshake, name → value (names are header tokens, values have no line breaks and at most 4096 characters; at most 32). |
| `request_timeout` | duration | `40s` | 1s to 10m. Keep it above the channel's `CORE_SYNC_TIMEOUT` (30s by default): a minion giving up sooner than the channel waits for core drops replies still on their way. |
| `checkin_interval` | duration | `60s` | 1s to 168h. How often to check in with nothing to send. |
| `checkin_jitter` | int (%) | `20` | 0 to 100. Random spread around the interval. |
| `ws_reconnect_backoff` | duration | `60s` | 1s to 1h. Longest wait between WebSocket reconnects (from 1s, doubling). |

There is no transport, method or path parameter: the channel accepts plain
requests and WebSockets, any method, any path, and the minion is free to use and
switch between them. A factory that lets operators choose them declares its own
[connection parameters](../minion-build/#connection-parameters).

## Design notes

- **The channel owns its parameters.** Core cannot know what a DNS or GitHub
  channel needs; a channel can. Reusing the management field specs means one
  validator and one form renderer for both.
- **Ready-to-use values, not configuration.** Endpoints spare operators
  retyping values; the channel does not depend on them and a minion keeps its
  own copy. That is why they can belong to a kind: nothing needs to know which
  instance answers an address.
- **Owned by the operation.** Addresses, fronts and headers differ per
  engagement, and the people who create minions are the operation's members,
  not app admins. The schema stays global: it describes the channel, not the
  operation.
- **Revalidate on read.** A schema changes with a channel's release, not with
  the endpoint. Checking on every read makes a stale endpoint visible before a
  minion is built from it, instead of silently exporting values the channel no
  longer understands.
- **No message size in the schema.** The channel's `max_body_bytes` can change
  after minions are built. Minions choose their own message size; one that sends
  more than the channel accepts fails like any other failure, and the channel
  reports it as `too_large` (log outcome and status counter), so lowering the
  limit too far shows up at once.
- **Defaults resolved in the export.** The minion gets concrete values and never
  interprets a schema; a later change of a default does not change minions
  already built.
