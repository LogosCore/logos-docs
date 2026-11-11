---
title: Credentials
description: Credential fields in channels' and factories' schemas, what core checks, and what a module gets.
---

An operation's credentials are findings that operators (and agents) record:
a password, a key, a ticket, each of a **type** with fields of its own. A
module can take them as values: a channel's target logs in with them, a
factory signs an artifact with a certificate, a command runs as an account.
The module declares a **credential field**; operators pick credentials from
the operation's; core keeps their ids and gives the module the credentials
themselves when it uses them.

## Types and their fields

What core gives a module of a credential is its id, its name, its type and
the fields of its type that hold a value (`*` required):

| Type | Fields |
|---|---|
| `PLAINTEXT` | `username`, `realm`, `password`* |
| `KEY` | `username`, `key`*, `passphrase` |
| `CERTIFICATE` | `username`, `realm`, `certificate`*, `private_key`, `password` (a PFX's) |
| `TICKET` | `username`, `realm`, `ticket`* (kirbi or ccache, base64), `service`, `expires_at` (RFC 3339) |
| `HASH` | `username`, `realm`, `hash`*, `algorithm` |
| `HEX` | `username`, `realm`, `hex`* (hex digits, whole bytes), `algorithm` |
| `OTHER` | `username`, `password`, `keys` (each a `name` and its `content`) |

A credential holds a value in no field its type does not take. What else
core keeps of it, its properties, tags, validity and comments, is the
operators' notes: it never goes to a module. The types and fields are the
protocol's (`protocol.CredentialTypes`, `protocol.CredentialTypeFields`),
so a module checks what it gets against the same table core keeps
(`Credential.Validate`).

## Credential fields

Two [field types](../module-management/#field-types):

| Type | JSON value | Rules |
|---|---|---|
| `credential` | string: a credential's id | `accept`: the credential types it takes (`KEY`, `PLAINTEXT`…), any when empty. No `default`. |
| `credential_list` | array of credential ids, in order (the order a channel tries them in) | `accept` as above; no id twice; `max_items` (16 at most); `required` means at least one. No `default`. |

They are taken where what holds the values belongs to an operation, as
credentials do: a [connection schema](../minion-connection/)'s fields (an
endpoint's) and its targets' fields, and a [build
schema](../minion-build/#field-types-for-builds)'s fields, connection
parameters and command params. A management manifest that declares one is
refused: a module's settings are no operation's. Nor is either a status
value's type.

## What core checks

When values are saved (a target, an endpoint, a build, a task), each id must
be one of the operation's credentials, of a type its field accepts. Core
keeps the ids beside the values, so a credential's details say where it is
used: the targets and endpoints naming it (with what their fields take, and
how its logins fared), and how many builds and tasks it went into.

Deleting a credential a target or an endpoint names is not refused: the
operator is warned. A conversion to a type a field naming it does not take
is warned about too. Either way the next use finds it unusable:

| Where | When the credential is resolved | A credential gone or of a type the field does not take |
|---|---|---|
| A target's values | at every call and open: an edit reaches the next one | the target needs editing (checked before each call), or is refused |
| An endpoint's params | with each call and open, and into each build | as for a target, and a build fails |
| A build's values and connection values | when a factory is offered the build; core records each credential's revision | the build fails, `credentials` |
| A command's params | when the task is queued: the task carries them | the task is not queued |

## What a module gets

The ids stay where core keeps the values; the credentials travel beside
them, by id, so a module checks values against its schema as before:

- A **build request** has `credentials`: the credentials its `values`, its
  connections' `values` and their endpoints' `params` name, by id (JSON:
  [`factory.build`](../minion-build/#factorybuild)).
- A **link `call` or `open`** has key 12, `credentials`: the credentials its
  values name, by id (CBOR, [the control
  link](../channel-core-connections/#the-control-link-and-connection-sockets-formats)).

`protocol.FieldCredentials(field, value, given)` reads a field's: the
credentials in the value's order, each checked against the field's
`accept`. An id core gave none for is an error: the request is not whole.

A **task** carries the credential itself in its arg, since a minion has no
way to look one up: a `credential` param's arg is the credential, a
`credential_list`'s an array of them ([Tasks](../minion-messages/tasks-and-results/#tasks)),
read with `protocol.ArgCredential` and `ArgCredentials`. A
[minion config](../minion-build/#the-minion-config) does the same with a
numbered credential field of a build or a connection: the credential in
place of the id, read with the same functions.

```cddl
credential = {
  1: tstr,          ; id
  ? 2: tstr,        ; name
  3: tstr,          ; type: PLAINTEXT, KEY, CERTIFICATE, TICKET, HASH, HEX, OTHER
  ? 4: tstr,        ; username
  ? 5: tstr,        ; realm
  ? 6: tstr,        ; password
  ? 7: tstr,        ; key
  ? 8: tstr,        ; passphrase
  ? 9: tstr,        ; certificate
  ? 10: tstr,       ; private_key
  ? 11: tstr,       ; ticket
  ? 12: tstr,       ; service
  ? 13: tstr,       ; expires_at, RFC 3339
  ? 14: tstr,       ; hash
  ? 15: tstr,       ; hex
  ? 16: tstr,       ; algorithm
  ? 17: [* { ? 1: tstr, 2: tstr }],  ; keys: name, content
}
```

In JSON (a build request) the keys are the field names: `id`, `name`,
`type`, `username`, `realm`, `password`, `key`, `passphrase`,
`certificate`, `private_key`, `ticket`, `service`, `expires_at`, `hash`,
`hex`, `algorithm`, `keys`.

A module keeps what it gets as it keeps any secret value: for the request
only, never logged, never reported back.

## Logins

A channel that logs in with a target's credentials says how each it tried
fared: an `answer`'s key 13, `logins`, in the order it tried them, each
`{1: the credential's id, 2: true}` for the one the target took and `{1: id}`
for one it refused. One it never got to is not listed. A channel acting as
the minion (an [agentless](../agentless-channels/) kind) tries them in the
target's order until one is taken.

Core notes each login on the target (taken or refused, when), shown on the
credential's details. One the target took is marked **valid**: it works.
One refused is noted on the target only, not marked invalid: a key may open
one server and not another. Core takes logins only for the credentials it
gave the call: a channel naming any other is ignored.

A minion's [`identity`](../minion-messages/identity/#credentials) that
names a credential (one its task gave, used and accepted: a become's
password) marks it valid the same way.

## Design notes

- **Ids where the values are kept, credentials beside them when sent.** The
  values a module's schema checks stay ids on both sides, so the schema
  check is the same in core and in the module; the credentials come beside
  the values, as a build request's files do. Only a task carries them in
  place of the ids: a minion has no one to look them up with.
- **Resolved at use.** A target's credentials are resolved for every call,
  so a credential edited (rotated, its passphrase added) reaches every
  target at the next call. A build resolves them once: the artifact keeps
  what it was built with, and core records which revision went in.
- **Notes stay with operators.** Properties, tags, validity and comments are
  for people: no module reads them, and the wire carries none of them.
- **Valid on a login, never invalid.** A login taken is proof the credential
  works; a login refused proves only that this target refused it.
