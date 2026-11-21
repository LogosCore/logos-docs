---
title: Field Types
description: The one field description and set of types every schema uses, where each type may be used, and each value's form in JSON and in a minion's CBOR.
---

Every value an operator sets for a module goes through one **field
description**, with one set of **types** and one set of checks: a module's
management properties and action params, a channel's connection fields and
target fields, and a factory's build fields, connection parameters and
command params. A type means the same everywhere; what differs by place is
which types a schema may use, and the form the value takes on its way.

The protocol package holds it all: `FieldSpec`, the `Field…` type constants
and the checks every schema passes through (`ValidateManifest`,
`ValidateConnectionSchema`, `ValidateBuildSchema`), which core and a module's
tests run alike.

## Where fields are

| Place | Its fields | Page |
|---|---|---|
| A module's manifest | its properties, its actions' params | [Module Management](../module-management/#the-manifest) |
| A channel's connection schema | each kind's fields (an endpoint's settings), each bind kind's target fields | [Minion Connection Schema](../minion-connection/#the-schema) |
| A factory's build schema | the build's fields, its connection parameters per channel and kind | [Minion Build](../minion-build/#the-build-schema) |
| A factory's commands | each command's params: a task's args | [Minion Build](../minion-build/#commands) |

## The field description

| Field | Meaning |
|---|---|
| `key` | Identifier, `^[a-z][a-z0-9_]{0,62}$`, unique within its list. |
| `num` | The field's number on the wire, 1 to 65535: required of a command's params, a build's fields and connection parameters, and a connection schema's fields, which a minion reads by number; refused for a module's own fields. A number stays its field's: a new field takes one never used, and a removed field's is not given again ([Field numbers](../minion-connection/#field-numbers)). |
| `type` | One of the [types](#types). |
| `label`, `description` | Shown in the UI. Up to 120 and 1000 bytes. |
| `group`, `order`, `unit`, `placeholder` | UI hints only. |
| `format` | For `string`, `secret` and `int`: what the value is, so the UI can offer a helper ([Formats](#formats)). For `structured`, what the value is, checked by core. |
| `required` | A value must be present (and, for strings, non-empty; for a `string_list` or `string_map`, no empty item or value; for an `enum_list`, at least one option). |
| `default` | The value when none is given. Must satisfy the field's own constraints. None for `file`, `stream`, `credential` and `credential_list` (what they name belongs to an operation); not to be set for `secret`: core does not check it, and never shows one. Where core fills it in, and where it only pre-fills a form, is the place's: [Defaults](#defaults). |
| `min`, `max` | Numbers for `int` / `number` / `bytes`, duration strings for `duration`, RFC 3339 timestamps for `datetime`. |
| `pattern`, `max_length` | For string-like types (each item of a `string_list`, each value of a `string_map`). `pattern` is a Go (RE2) regular expression, unanchored: anchor it with `^…$` to match the whole value. |
| `key_pattern` | For `string_map`: what every key must match. |
| `max_items` | For `string_list`, `string_map`, `enum_list` and `credential_list`: most items or entries. |
| `options` | For `enum` and `enum_list`: 1 to 64, each a `value`, optional `label` and `description` (shown under the label in the option list). |
| `accept` | For `file`: up to 32 extensions (`.ico`) or media types (`image/x-icon`, `image/*`), any file when empty. For `credential` and `credential_list`: the credential types taken. |
| `max_size` | For `file`: the largest file, in bytes. For `structured`: the largest value, in bytes of its CBOR form. |
| `when` | An action's or a command's param only: it applies while another param of the same form, an `enum` with no `when` of its own, holds one of `values`: `{"key": "front", "values": ["forward"]}`. The UI shows it only then, and leaves it out of what it sends; one given otherwise is refused, it takes no default, and a `required` one is required only while it applies. A command's may name a param core adds to its [action](../task-results-and-actions/). Refused anywhere else. |
| `advanced` | An action's or a command's param only: one seldom changed. The UI shows it under More options, folded until opened or until it has a problem to show. Refused anywhere else. |
| `platforms` | A build's field only: the platforms (`os/arch`, either half `any`) of the builds it applies to ([Fields for some platforms](../minion-build/#fields-for-some-platforms)). Refused anywhere else. |

## Types

Each type has one JSON form (what the API, the web app and a module's
manifest, build request and management calls carry) and one CBOR form (what
a minion gets: a task's args, by their params' numbers, and the [minion
config](../minion-build/#the-minion-config)'s values, the same way).

| Type | JSON value | Rules | CBOR, to a minion |
|---|---|---|---|
| `string` | string | `pattern`, `max_length` | text |
| `int` | integer | `min`, `max`; fits in int64 | integer |
| `number` | number | `min`, `max` | float |
| `bool` | boolean | — | `true` / `false` |
| `enum` | string | one of `options[].value` | text |
| `duration` | string, Go syntax, e.g. `"30s"` | `min`, `max` as durations | unsigned integer, milliseconds |
| `bytes` | integer | not negative; `min`, `max` | integer, a byte count |
| `url` | string | absolute URL (scheme and host) | text |
| `secret` | string | write-only: never returned by core or by the module | text |
| `string_list` | array of strings | each item as a `string`; `max_items` | array of text |
| `string_map` | object of string keys to string values | keys non-empty and matching `key_pattern`; each value as a `string`; `max_items`; key order not kept | map of text to text |
| `datetime` | string, RFC 3339, e.g. `"2027-01-31T00:00:00Z"` | `min`, `max` as RFC 3339 | integer, unix seconds |
| `enum_list` | array of option values | each one of `options[].value`, no repeats; `max_items`; `required` means at least one | array of text |
| `file` | string: a file's id | `accept`, `max_size`; no `default` | a command's: `file-offer`, the [file core sends](../minion-messages/file-transfers/#core-sending-a-file) for the task. A build field's: not in the minion config (the factory handles the file) |
| `stream` | string: the file's name | no `default`, no rules of a file's | `file-offer`, the [file core streams](../minion-messages/file-transfers/#streaming-a-file-to-a-minion) for the task |
| `credential` | string: a credential's id | `accept` | the [credential](../credentials/#what-a-module-gets) itself, in place of the id |
| `credential_list` | array of credential ids, in the operator's order | `accept`, `max_items` | array of credentials |
| `structured` (draft) | any JSON value but `null` | `format`, `max_size` (at most 64 KiB); 12 levels deep at most | the value's CBOR form ([Structured values](../minion-build/#structured-values)) |

A module reads a value in either form with the protocol package's functions:
`protocol.ArgString`, `ArgInt`, `ArgBool`, `ArgNumber`, `ArgDuration`,
`ArgStrings`, `ArgStringMap`, `ArgFile`, `ArgStructured`, `ArgCredential` and `ArgCredentials`
for a minion's CBOR; a credential field's credentials in a build request or
a link call with `protocol.FieldCredentials`.

## Which types where

One type set, four kinds of place; a schema that uses a type its place does
not take is refused.

| Type | Management (properties, action params) | Connection schema (kinds, targets) | Build fields, connection parameters | Command params |
|---|---|---|---|---|
| `string`, `int`, `number`, `bool`, `enum`, `duration`, `bytes`, `url`, `secret`, `string_list`, `string_map`, `datetime`, `enum_list` | ✓ | ✓ | ✓ | ✓ |
| `credential`, `credential_list` | — | ✓ | ✓ | ✓ |
| `file` | — | — | ✓ (a [build file](../minion-build/#build-files)) | ✓ (a [task file](../task-results-and-actions/#task-files)) |
| `stream` | — | — | — | ✓ |
| `structured` (draft) | — | — | — | ✓ |

- **Credentials** belong to an operation: a module's own settings are no
  operation's, so management refuses them ([Credentials](../credentials/#credential-fields)).
- **One file or stream** per command at most.
- **Status values** a module reports take any type but `secret`, `file`,
  `stream`, `structured` and the credential types.

## Defaults

- **A management property**: the module's own value when core holds none
  (typically what it read from its environment).
- **An action param**: it only pre-fills the form; neither core nor the
  module fills in an absent param.
- **A build field, a connection parameter, a connection field**: core fills
  it in, and a build request carries every value with its defaults.
- **A command param**: core fills it in before the task is queued, so a
  minion gets every arg that has a value or a default.

## Formats

`format` names what a `string`, `secret` or `int` is, so the UI can offer a
helper: a lowercase name like a key. The value is never checked against it,
and a format the UI does not know is ignored.

| Format | Types | What the UI does |
|---|---|---|
| `user_agent` | `string` | Generates an HTTP User-Agent from an OS, a browser available on it and one of its four newest versions, by the release dates its vendor publishes (the default: the newest out for a week; a release only scheduled when the dates were read counts two weeks late), or a common one at random. Under the field it says what the value is and how many versions behind its browser, warns when it is outdated or carries what no real browser sends (a version not out yet, `Windows NT 11.0`, a full Chrome version, Safari off Apple's systems, Edge without Chrome's token, Windows 7 or 8 with a browser that left them, Firefox's `rv:` apart from its version, `HeadlessChrome`), and offers the same OS and browser at the default version. |
| `path` | `string` | Generates URL paths (`/cdn/assets/`) of 1 to 6 words from word lists it ships, divided by `/`, `-`, `.` or `_`, offering only those that pass the field's `pattern` and `max_length`. |
| `multiline` | `string`, `secret` | Edits the value in a box of several lines (a PEM key), which keeps its line breaks, a secret's too; a one-line box drops them. |
| `timezone` | `string` | A time zone as IANA names it (`Europe/Berlin`, `UTC`): suggests the browser's own list as it is typed, by any part of the name, each with its offset now, the browser's own zone first; a name typed whole is taken as it is. |
| `connection` | `int` | One of a minion's connections, by its place from 1: a command's param, such as [`switch_connection`](../task-results-and-actions/#switch_connection)'s `conn`. A session's command form picks it from the session's connections by name, kind and address, and its console takes and completes it by name. |

A `structured` value's `format` is another thing: core checks the value
against it, and `connection` (a connection for the minion, sent in its
numbered form; picked from the session's in the command form, then edited
as JSON) is the one so far ([Structured values](../minion-build/#structured-values)).

## Design notes

- **One type system.** A value an operator sets means the same in a
  property, an endpoint, a build and a task, so one form, one check and one
  helper serve them all, and a type added once reaches every place that may
  take it. Places differ only by what they may hold: an operation's
  credentials and files have no meaning in a module's own settings, and a
  stream or a structured value only in a task.
- **Two forms.** JSON is for people and servers, which read names and
  strings (`"30s"`); CBOR by number is for minions, which carry no names and
  read integers (milliseconds) without a parser for durations or dates.
