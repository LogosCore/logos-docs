---
title: "Wire Format"
---

What every minion message is, whatever it carries: a CBOR map, sealed in a
frame with the minion's keys. The items inside are defined on the other
[Minion Messages](../) pages.

## Sealed frame

For the suite `aes-256-cbc-hmac-sha256`, with an `enc_key` and a `mac_key`:
the build's own ([Minion Build](../../minion-build/#factorybuild)), or the
new ones staging gives a process ([Sessions](../sessions/#staging)).

```
 0                 16     17                       n−33   n−32        n
 ┌─────────────────┬──────┬────────────────────────┬──────┬───────────┐
 │ IV (16)         │ ver  │ ciphertext (16·k)      │ dir  │ tag (32)  │
 └─────────────────┴──────┴────────────────────────┴──────┴───────────┘
```

| Field | Meaning |
|---|---|
| `IV` | 16 random bytes from a CSPRNG, fresh for every frame. |
| `ver` | `0x01`, this layout. |
| `ciphertext` | AES-256-CBC of the message with `enc_key` and `IV`, PKCS#7 padded. |
| `dir` | `0x01` minion → core, `0x02` core → minion. |
| `tag` | HMAC-SHA256 with `mac_key` over `id ‖ IV ‖ ver ‖ ciphertext ‖ dir`, all 32 bytes. |

`id` is the 16 raw UUID bytes of the id the message is sent under: the build
id, a temporary id or a session id ([Sessions](../sessions/#staging)). The tag
covers it, but the frame does not carry it: the transport does, where it
carries a build id, and the channel hands it to core in `Logos-Build-Id`.

A receiver checks, in this order, and drops the frame at the first failure:

1. the length is at least 66 bytes, and the ciphertext (the length minus 50)
   a multiple of 16;
2. `ver` is `0x01`, and `dir` is the other side's;
3. the tag, compared in constant time;
4. only then decrypts, and checks the padding.

A frame adds 51 to 66 bytes to its message. Core answers a frame it cannot
open (no keys for its id, or a check failed) with **422** to the channel
([HTTP Sync](../../channel-core-sync/)); a minion treats a reply it cannot
open as no reply.

## Message

The plaintext is one CBOR map. There are two formats, one per direction; the
frame's `dir` says which one to parse. Its keys are numbers, as are those of
every item and of the structures inside them, and so are the closed sets of
values (item types, err codes, integrity levels, entry types, a task's
command and its args): see the [Registry](#registry). These pages call each
key by its name, and each CDDL gives the number with the name beside it.

```cddl
minion-message = {      ; minion → core
  0: 3,                 ; v: this format
  ? 1: msg-id,          ; id: when it starts an exchange
  ? 2: msg-id,          ; re: when it answers one
  ? 3: [* minion-item], ; items: absent or empty, nothing to say
}

core-message = {        ; core → minion
  0: 3,                 ; v
  ? 1: msg-id,          ; id
  ? 2: msg-id,          ; re
  ? 3: [* core-item],   ; items
  ? 4: uint,            ; at: core's clock when it starts the exchange,
                        ;   unix seconds; on every message with id
}

minion-item = stage / hello / sleep_update / conn_update / get_tasks / max_tasks / feedback / result / chunk / ack / err
core-item   = stage_response / hello_response / rehello / task / cancel / max_tasks / resume / poll / chunk / ack / err

msg-id  = bstr .size 16
task-id = bstr .size 16
xfer-id = bstr .size 16
```

- **Exactly one of `id` and `re`.** The side that starts an exchange picks an
  `id` (16 bytes from a CSPRNG); the answer carries it back as `re`. Below,
  **request** is the message that starts an exchange and **reply** its
  answer.
- **Items keep their direction**, whoever starts: tasks always go core →
  minion, results always minion → core.
- **Any number of items**, up to 256, so one check-in can bring several
  results and one reply several tasks.

Who starts depends on the channel's [connection
kind](../../../module-types/#connection-kinds):

| Connection | Starts the exchange | Its message has | The answer has |
|---|---|---|---|
| `reverse-call` | the minion | `id` | `re` |
| `reverse-persistent` | either side | `id` | `re` |
| `bind-call` | core | `id` (and `at`) | `re` |
| `bind-persistent` | either side | `id` | `re` |

A minion message with `re` answers one core sent: core takes it over any
connection socket of the session, once, within 10 minutes of core's
message (the minion may have connected again), and never through the sync
call, where a minion only starts exchanges. An answer gets no reply: what
must arrive goes in a message the minion starts, whose reply says it did.

## CBOR rules

Both sides write, and accept, a subset of CBOR that maps onto JSON and back:

- map keys are unsigned integers in the protocol's own maps (the message, its
  items, the structures the [registry](#registry) numbers, the data of core's
  [results](../../task-results-and-actions/), and a task's `args`, by their
  params' numbers), and text in maps a factory shapes itself (the data of a
  command without a result, an `x`); each key once;
- definite lengths only;
- no tags, no `undefined`, no simple values other than `false`, `true` and
  `null`;
- text is valid UTF-8;
- integers and floats in their shortest form.

A reader enforces the [limits](#limits) before it trusts a length: nesting at
most 16 deep, at most 256 items in a message, at most 65 536 elements in an
array or map, and no string longer than the bytes left. Ids are raw bytes
(16, not a 36-character UUID), durations are milliseconds and times are unix
seconds, so a minion parses integers only.

## Freshness and replay

A minion's messages carry no time: core stamps each with its own receive time. Core's messages that start an exchange say its clock (`at`), for a minion that cannot remember ids (below).

- **A message whose `id` core has seen gets the reply it got**, for 10
  minutes (a reply of at most 64 KiB): a request whose reply was lost on
  the way is sent again as it was, the same message, and nothing in it runs
  twice. A minion sends a message again only so; a new message has a new
  `id`.
- **Core refuses a message whose `id` it has seen** in the last 24 hours,
  past that: the sync call answers **409**, and the channel answers its
  client as for any failure (the HTTP channel's 404); over a connection
  socket core drops it and answers nothing. Only a captured message sent
  again meets this, and it learns nothing from the answer: a reply core
  kept is sealed for the minion.
- **A reply is fresh** when its `re` is the `id` of a request the receiver is
  still waiting on. An old reply, replayed, matches nothing and is dropped.
- **The direction byte** stops a frame from being turned around: both sides
  hold the same keys, and a core message sent back to core fails `dir`.
- **A minion answering core's requests** (a `bind` or persistent
  connection) needs no replay protection of its own: core does not rely on
  it. Without it, a captured core message sent to the minion again runs its
  tasks again. A minion guards against that by remembering recent `id`s
  (BOB's remembers task ids for a day), or, when it can remember nothing
  (a `bind-call` page), by **`at`**: every message core starts says core's
  clock, and a minion refuses one further than 10 minutes from its own
  (`protocol.StaleWindow`) with an `err` `stale`, saying its time. Within
  that window a replay still runs again; past it, it does not. Core shows
  a page that refuses calls as stale on its target: the two clocks
  disagree.

## Errors

```cddl
err = {
  0: 13,                ; t: err
  1: uint,              ; code: one of the codes below
  ? 2: tstr,            ; msg: for a person
  ? 3: uint,            ; item: which item of the message it is about (0-based)
  ? 4: bstr .size 16,   ; task: the task an unknown_task names
  ? 5: bstr,            ; ctx: the ctx the item it is about said, echoed
}
```

| `code` | Name | Sent by | Means | The receiver |
|---|---|---|---|---|
| 1 | `bad_message` | both | the message, or an item in it, is not valid | logs it; a task or transfer the item was about ends failed |
| 2 | `unknown_item` | both | an item type the receiver does not know (`item` says which) | logs it |
| 3 | `unknown_task` | both | a `cancel`, `reack`, `chunk` or `ack` for a task or transfer the receiver does not have | ends that task or transfer: core ends a task the minion names (`task`) cancelled when it had asked to stop it, failed otherwise |
| 4 | `too_large` | both | a message, chunk or file over the [limits](#limits) | ends the task or transfer it was about failed |
| 5 | `session_closed` | core | the session the message was sent under is [closed](../sessions/#session-lifetime) | starts over |
| 6 | `session_replaced` | core | another process claimed the [persisted session](../sessions/#persisted-sessions) | starts over, without claiming it |
| 7 | `stale` | minion | a core message whose `at` is too far from the minion's clock, or says none: a replay, or clocks that disagree (`msg` says the minion's time) | nothing in it ran; core shows it on the target |

These pages call a code by its name; on the wire it is the number.

**An `err` about an item that said a `ctx`** (a chunk, an ack, a result)
carries that `ctx` back: a minion that keeps nothing between messages finds
there what to end or clean up (a page removes the partial file a refused
upload left).

Only `session_closed` and `session_replaced` end a session; every other code
is about one message or item, and the session goes on. A frame that fails to
open gets no `err`: the receiver cannot tell who sent it. What a minion does
when an exchange fails is in [Sessions](../sessions/#when-an-exchange-fails).

## Limits

| | |
|---|---|
| A message (plaintext) | 768 KiB: sealed and packed, it fits the HTTP channel's 1 MiB default `max_body_bytes`. Less on a connection whose channel says it carries less (`max_message`, below) |
| Items in a message | 256 |
| Elements of an array or map inside an item (a result's `data`) | 65 536 |
| Nesting | 16 levels |
| A chunk's data | 512 KiB |
| A file a minion sends core, or core sends a minion | 2 GiB by default (core's `MINION_FILE_MAX_SIZE`) |
| A file streamed either way | none: core holds a few chunks of it at a time |
| A task's output and data kept | 4 MiB together; its listings go to the [file browser](../../file-browser/) apart |
| Core's memory of message ids | 24 hours |
| Task ids a minion remembers | 24 hours |

**A connection's own limit.** A channel whose transport carries little (a
DNS query, a small form field) says per kind how large a message it carries
each way, `max_message` in its [connection
schema](../../channel-core-connections/#the-connection-schema-by-kind), 1 KiB
to 768 KiB. A build's connection takes it (`max_message`), so the minion
knows it, and core keeps every message it sends a minion within the
connection in use: what does not fit (tasks, a chunk) waits for the next
message, and a task no message of the connection could carry ends failed,
saying so. A minion keeps its own messages within it too: smaller chunks,
listing pieces and result parts.

Session timings (the first check-in, tombstones, replaced keys, the
backstop) are in [Sessions](../sessions/).

Example sizes, CBOR plaintext → sealed → packed by the HTTP channel, with
the same message's text-keyed forms for comparison:

| Message | CBOR | With text keys (v 1) | JSON | On the wire |
|---|---|---|---|---|
| empty check-in (busy) | 21 B | 24 B | 39 B | 99 B |
| check-in asking for one task | 28 B | 49 B | 75 B | 99 B |
| `hello` (one address) | 146 B | 255 B | 331 B | 227 B |
| reply with two tasks | 87 B | 152 B | 231 B | 163 B |
| ack and one result with 17 bytes of output | 91 B | 131 B | 210 B | 163 B |
| a listing of 20 files | 776 B | 1 903 B | 2 632 B | 851 B |

## Registry

Every number the protocol gives a name. A number, once given, is never
reused for something else: a key or type that goes away leaves its number
unused. The protocol package holds the same numbers (the `cbor` tags of its
types, and the item and code constants), and a test fails when one moves.

**Item types**, an item's key `0` (`t`). Every item is a map whose key `0`
says its type; its own fields count from `1`, numbered per item, and are
given in its CDDL on the page that defines it.

| `t` | Item | `t` | Item |
|---|---|---|---|
| 1 | [`stage`](../sessions/#stage) | 8 | [`task`](../tasks-and-results/#tasks) |
| 2 | [`stage_response`](../sessions/#stage) | 9 | [`cancel`](../tasks-and-results/#cancelling-a-task) |
| 3 | [`hello`](../sessions/#hello) | 10 | [`result`](../tasks-and-results/#results) |
| 4 | [`hello_response`](../sessions/#hello) | 11 | [`ack`](../tasks-and-results/#acknowledging) |
| 5 | [`sleep_update`](../sessions/#late-and-lost-sessions) | 12 | [`chunk`](../file-transfers/#chunks) |
| 6 | [`rehello`](../sessions/#hello) | 13 | [`err`](#errors) |
| 7 | [`get_tasks`](../tasks-and-results/#asking-for-tasks) | 14 | [`conn_update`](../sessions/#connections) |
| | | 15 | [`resume`](../tasks-and-results/#resuming-a-task) |
| | | 16 | [`poll`](../tasks-and-results/#coming-back-sooner) |
| | | 17 | [`max_tasks`](../tasks-and-results/#max-tasks) |
| | | 18 | [`feedback`](../sessions/#feedback) |
| | | 19 | [`reack`](../tasks-and-results/#tasks-the-minion-lost) |
| | | 20 | [`identity`](../identity/) |
| | | 21–25 | [`tunnel`, `tunnel_reply`, `tunnel_data`, `tunnel_ack`, `tunnel_close`](../tunnels/#streams) |
| | | 26 | [`tunnel_datagram`](../tunnels/#udp) |

**The message**: `v` 0, `id` 1, `re` 2, `items` 3, and core's `at` 4, as [above](#message).

**Structures inside items**, numbered from `1` each, in the CDDL where they
are defined: a [sleep](../sessions/#hello), a [listing
piece](../tasks-and-results/#listings) and its entries, a [file
offer](../tasks-and-results/#tasks) (a `file` or `stream` arg), the [stage
keys](../sessions/#stage), and the data of each of core's
[results](../../task-results-and-actions/) (given under its shape there).

**Values**, numbered from `1` each:

| Set | Numbers | Defined in |
|---|---|---|
| Err codes | `bad_message` 1 … `stale` 7 | [Errors](#errors) |
| Integrity levels | `low` 1, `medium` 2, `high` 3, `system` 4, `root` 5, `user` 6 | [Sessions](../sessions/#hello) |
| Identity scopes | the session's 1, one task's 2 | [Identity](../identity/) |
| Identity ways (`how`) | impersonation 1, network 2, become 3 | [Identity](../identity/) |
| Machine id sources | `smbios-uuid` 1 … `ephemeral` 10 | [Sessions](../sessions/#machine-identity) |
| Entry types | `dir` 1, `file` 2, `link` 3, `other` 4 | [Listings](../tasks-and-results/#listings) |
| Listing errors | denied 1, not found 2, other 3 | [Listings](../tasks-and-results/#listings) |

A value a receiver does not know is taken and shown by its number (core
reads an entry type it does not know as `other`).

**Commands and args.** A task names its command by the number the build
schema gives it (`op`) and its args by their params' numbers (`num`): the
factory's numbers, declared in its [schema](../../minion-build/#commands),
so a minion carries no command or param names.

What stays text: values that are data (a host's `os` and `arch`, paths,
names, versions, messages for a person), and what a factory shapes itself:
the data of a command without a result, and every `x`. Core keeps and shows
everything by name: the hello's values, listings (an entry's mode rendered as
the host shows it) and data are named as they come.

## Open questions

- **Keys per direction.** One key pair serves both directions, and the
  direction byte stops reflection. Separate pairs would limit what one leaked
  direction exposes, at the cost of four keys per build.
- **Compression.** Compressing before encrypting saves bytes on text output,
  but leaks through sizes when attacker-chosen data shares a message with
  secrets. Left out unless a command asks for it.

## Design notes

- **Why numbers.** A message's text keys, item types, codes and closed
  values were a third of its size or more, over half of a listing's (see the
  [example sizes](#limits)), and they were the same in every message of
  every minion: words like `stage_response`, `machine_id` or a command's
  name in a minion's binary say what it is. Numbers make messages smaller
  and leave the protocol's and the build's vocabulary out of the minion.
  Names live in the docs, the protocol package, the build schema and core,
  which names everything as it comes. A listing goes furthest: an entry's
  mode is the host's bits rather than its rendering, and owners travel once
  a piece. What a factory shapes itself (its own data, `x`) keeps text
  keys: core shows it as it is.
- **Why CBOR.** Messages are designed like JSON, but files, screenshots and
  raw command output travel as bytes: no base64 inside the encryption, and
  none outside it either, since the sync call carries the ciphertext raw. The
  subset above converts to JSON and back (a numbered key named from the
  registry), so a message can always be shown as JSON.
- **Why encrypt-then-MAC with the full tag.** The tag is checked before
  anything is decrypted, so a forged or altered frame never reaches the CBC
  padding check, the classic way CBC leaks. A 32-byte tag costs 16 bytes more
  than a truncated one and leaves nothing to argue about.
- **Why the id is in the tag.** A frame is valid only under the id it was
  sent with, whatever a channel does to the header.
- **Why two formats, by direction.** Only three item types go both ways, so a
  minion message with a `task`, or a core message with a `result`, is simply
  invalid: a frame turned around fails to parse even before `dir` is checked.
  A minion writes only minion messages and reads only core messages, so its
  codec covers half the items. Who starts an exchange (`id` or `re`) is kept
  apart from direction, so the same formats serve every [connection
  kind](../../../module-types/#connection-kinds): the minion starting, core starting, or both.
- **Why so little time in messages.** Core trusts only its own clock, so
  it stamps messages as they arrive. The sync call is request and
  response, so a minion needs no clock either to know a reply is fresh: it
  matches `re`. Only the messages core starts say `at`, for a minion that
  cannot remember ids: a page's server keeps its clock, where it keeps
  nothing else.
