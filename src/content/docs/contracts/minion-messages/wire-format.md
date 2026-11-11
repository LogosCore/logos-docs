---
title: "Wire Format"
---

What every minion message is, whatever it carries: a CBOR map, sealed in a
frame with the minion's keys. The items inside are defined on the other
[Minion Messages](../) pages. CBOR and this frame are core's codec, every
build's unless it names another; [Codecs](../codecs/) adds a JSON envelope
of core's and a factory's own envelope or suite.

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
covers it, but the frame does not carry it: the transport does, and the
channel hands it to core beside the frame: `Logos-Build-Id` on the sync
call, key 1 of a connection socket's frame, key 3 of the control link's
`call` and `answer`.

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

minion-item = stage / hello / sleep_update / conn_update / get_tasks / max_tasks
            / feedback / identity / result / chunk / ack / err
            / tunnel / tunnel_reply / tunnel_data / tunnel_ack / tunnel_close
            / tunnel_datagram / tunnel_listen / tunnel_ctl / delegate / packed
core-item   = stage_response / hello_response / rehello / task / cancel / max_tasks
            / resume / poll / reack / chunk / ack / err
            / tunnel / tunnel_reply / tunnel_data / tunnel_ack / tunnel_close
            / tunnel_datagram / tunnel_ctl / delegate / packed

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

## Compression

The protocol package (`Pack`, `Unpack`, `UnpackItems`) and core pack and
take packed items. BOB's factory declares `deflate`, and its minion inflates
and packs; Dumbo, Raven and the SSH module declare no compression.

A sender may send any item **packed**: deflated, inside a `packed` item,
which the receiver inflates and takes as the item it holds, in its place in
the message.

```cddl
packed = {
  0: 30,                ; t: packed
  1: uint,              ; alg: 1 deflate
  2: bstr,              ; the item, as the message's envelope writes it,
                        ;   deflated
}
```

- **One item each.** A packed item holds exactly one item of its own
  direction, never another packed one, in a compression context of its
  own: what one item says never changes the size of another.
- **In its place.** The receiver takes the item where the packed one
  stands: acks keep their order, and an `err` about it names the packed
  item's index (`item`) and echoes the `ctx` the item inside said.
- **DEFLATE**, raw ([RFC 1951](https://www.rfc-editor.org/rfc/rfc1951)),
  `alg` 1: in the standard library of every language a minion is written
  in (Go's `compress/flate`, .NET's `DeflateStream`, PHP's `gzinflate`,
  Python's `zlib`, JavaScript's `DecompressionStream("deflate-raw")`). No
  other algorithm has a number yet.
- **The envelope inside** is the message's: CBOR, or the JSON text under
  core's [JSON envelope](../codecs/#the-json-envelope). A factory
  that translates its envelope translates packed items too, or does not
  declare compression.

**Who packs.**

- **The factory says what its minions inflate**: the build schema's
  `compression`, `["deflate"]`. Core packs nothing for a minion of a
  factory that declares none.
- **On by default.** A build of a factory that declares it has compression
  on, unless the operator turns it off; the build request says it
  (`compression`: `"deflate"`, or absent for off), and the factory builds
  it into the minion. A minion packs only when its build has it on; core
  reads packed items from any minion.
- **The sender chooses each item.** Core packs an item of 256 bytes or
  more whose deflated form saves an eighth or more of it: as the outbox
  adds it to a message, and the rest (answers, chunks) as the message is
  sealed. It never packs a task whose args hold a credential, nor a
  delegate's item (a call or an open names a target's values and
  credentials; a frame is sealed, and does not shrink). A minion may
  follow the same rule. What does not shrink, a compressed file or TLS in
  a tunnel, goes as it is.

**Sizes.** The message's 768 KiB counts its items inflated; a connection's
`max_message` counts them as sent, so core, which deflates an item as it
adds it to a message, fits more into a connection that carries little. A
receiver inflates a packed item only into the room the message has left
(768 KiB less the items before it): one past it gets `too_large`, and one
that does not inflate, or holds no single item (or another packed one),
gets `bad_message`. An item of the other direction inside is answered as
it would be unpacked. A tunnel's offsets and windows count the stream's own
bytes: packing changes how its item travels, never its offsets.

**What sizes still say.** A packed item's size says how well its content
compresses, to anyone who sees the traffic. One context per item keeps a
secret in one item from being probed through data an outsider shapes in
another (a file on the host, a service's answer in a tunnel); an operator
who would rather show no such signal turns compression off for the build.

## Freshness and replay

A minion's messages carry no time: core stamps each with its own receive time. Core's messages that start an exchange say its clock (`at`), for a minion that cannot remember ids (below).

- **A message whose `id` core has seen gets the reply it got**, for 10
  minutes (a reply of at most 64 KiB; one core had nothing to say to gets
  its 204 again): a request whose reply was lost on the way is sent again
  as it was, the same message, and nothing in it runs twice. A minion sends
  a message again only so; a new message has a new `id`.
- **Core refuses a message whose `id` it has seen** in the last 24 hours,
  when it no longer keeps that message's reply (past the 10 minutes, or a
  reply over 64 KiB): the sync call answers **409**, and the channel
  answers its client as for any failure (the HTTP channel's 404); over a
  connection socket core drops it and answers nothing. A captured message
  sent again meets this, and learns nothing from the answer: a reply core
  kept is sealed for the minion.
- **What a minion does after a lost reply.** It keeps its session and sends
  what was not delivered again: the same message, within the 10 minutes,
  or the same items in a new message under a new `id`, which every item
  allows ([How an exchange
  goes](../tasks-and-results/#how-an-exchange-goes)). A message core
  refuses as a replay goes again as a new message. Two first messages
  differ: a `stage` sent as a new message gets a new temporary id (the
  first expires unused), and a `hello` under the build id sent as a new
  message opens a second session, so it goes again as the same message. A
  `hello` again under the same temporary id gets the session the first
  opened, within 10 minutes of it ([Sessions](../sessions/#hello)).
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
| | | 27 | [`tunnel_listen`](../tunnels/#reverse-port-forward) |
| | | 28 | [`tunnel_ctl`](../tunnels/#controls) |
| | | 29 | [`delegate`](../delegation/#the-item) |
| | | 30 | [`packed`](#compression) |

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
| Machine id sources | `smbios-uuid` 1 … `ephemeral` 10, `ssh-host-key` 11 | [Sessions](../sessions/#machine-identity) |
| Feedback levels | warning 1, error 2 | [Sessions](../sessions/#feedback) |
| Entry types | `dir` 1, `file` 2, `link` 3, `other` 4 | [Listings](../tasks-and-results/#listings) |
| Listing errors | denied 1, not found 2, other 3 | [Listings](../tasks-and-results/#listings) |
| Tunnel results | open 0, refused 1, host unreachable 2, network unreachable 3, timed out 4, not allowed 5, failed 6, unsupported 7, not found 8, denied 9, in use 10 (from 0) | [Tunnels](../tunnels/#streams) |
| Tunnel close reasons | done 1, reset 2, no such stream 3, task ended 4 | [Tunnels](../tunnels/#streams) |
| Tunnel open kinds | unix socket 1, named pipe 2, process 3, accept 4, ICMP 5 | [Tunnels](../tunnels/#streams), [VPN front](../../vpn-front/#icmp) |
| Tunnel signals | interrupt 1, terminate 2, kill 3 | [Tunnels](../tunnels/#controls) |
| Delegate steps | sync 1, reply 2, call 3, open 4, answer 5, frame 6, close 7 | [Delegation](../delegation/#the-item) |
| Delegate close reasons | closed 1, no such connection 2, task ended 3 | [Delegation](../delegation/#the-item) |
| Compression algorithms (`alg`) | deflate 1 | [Compression](#compression) |

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
- **Why compression per item.** Text output and listings deflate to a
  fifth or an eighth of their size, a binary to about half; a compressed
  file or TLS not at all, and a small item grows. One context for a whole
  message would mix items: data an outsider shapes beside a secret in one
  context is how compression leaks through sizes (CRIME, BREACH). A context
  per item keeps one item's content from shaping another's size, lets the
  sender skip what does not shrink, and is the unit core already plans
  messages by. Several small items in one context would gain a little and
  bring the mixing back: one item each keeps one rule.
- **Why DEFLATE.** Every language a minion is written in inflates it with
  its standard library. zstd compresses better and faster, but needs a
  library in most; a number for it comes when a minion needs one.
- **Why encrypt-then-MAC with the full tag.** The tag is checked before
  anything is decrypted, so a forged or altered frame never reaches the CBC
  padding check, the classic way CBC leaks. A 32-byte tag costs 16 bytes more
  than a truncated one and leaves nothing to argue about.
- **Why the id is in the tag.** A frame is valid only under the id it was
  sent with, whatever a channel does to the header.
- **Why two formats, by direction.** Each item type has its direction:
  seventeen go one way (`stage`, `hello`, `get_tasks`, `result` and the
  rest of the minion's; `task`, `cancel`, `reack` and the rest of core's),
  and thirteen go both ways (`ack`, `chunk`, `err`, `max_tasks`, the tunnel
  items but `tunnel_listen`, `delegate` and `packed`). An item of the other
  direction is not taken: core answers a minion's `task` with
  `unknown_item`. A minion writes only minion messages and reads only core
  messages, so its codec covers the items of its direction. The direction
  byte, not the parse, stops a frame turned around. Who starts an exchange
  (`id` or `re`) is kept apart from direction, so the same formats serve
  every [connection kind](../../../module-types/#connection-kinds): the
  minion starting, core starting, or both.
- **Why so little time in messages.** Core trusts only its own clock, so
  it stamps messages as they arrive. The sync call is request and
  response, so a minion needs no clock either to know a reply is fresh: it
  matches `re`. Only the messages core starts say `at`, for a minion that
  cannot remember ids: a page's server keeps its clock, where it keeps
  nothing else.
