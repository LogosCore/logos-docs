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
frame's `dir` says which one to parse.

```cddl
minion-message = {      ; minion → core
  v: 1,                 ; this format
  ? id: msg-id,         ; when it starts an exchange
  ? re: msg-id,         ; when it answers one
  ? items: [* minion-item],  ; absent or empty: nothing to say
}

core-message = {        ; core → minion
  v: 1,
  ? id: msg-id,
  ? re: msg-id,
  ? items: [* core-item],
}

minion-item = stage / hello / sleep_update / get_tasks / result / chunk / ack / err
core-item   = stage_response / hello_response / task / cancel / chunk / ack / err

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

Who starts depends on the module in between:

| Through | Starts the exchange | Its message has | The answer has |
|---|---|---|---|
| a channel (today) | the minion | `id` | `re` |
| a [dialer](../../../module-types/#3-dialer-modules-planned) (planned) | core; on a lasting connection, either side | `id` | `re` |

## CBOR rules

Both sides write, and accept, a subset of CBOR that maps onto JSON and back:

- map keys are text, each once;
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

Messages carry no time: core stamps each with its own receive time.

- **Core refuses a message whose `id` it has seen** in the last 24 hours:
  the sync call answers **409**, and the channel answers its client as for
  any failure (the HTTP channel's 404). A minion never sends an `id` twice,
  so only a captured message sent again meets this, and it learns nothing
  from the answer.
- **A reply is fresh** when its `re` is the `id` of a request the receiver is
  still waiting on. An old reply, replayed, matches nothing and is dropped.
- **The direction byte** stops a frame from being turned around: both sides
  hold the same keys, and a core message sent back to core fails `dir`.
- **A minion answering core's requests** (through a dialer) needs no replay
  protection of its own: core does not rely on it. Without it, a captured
  core message sent to the minion again runs its tasks again; a minion may
  guard against that by remembering recent `id`s.

## Errors

```cddl
err = {
  t: "err",
  code: tstr,           ; one of the codes below
  ? msg: tstr,          ; for a person
  ? item: uint,         ; which item of the message it is about (0-based)
}
```

| `code` | Sent by | Means | The receiver |
|---|---|---|---|
| `bad_message` | both | the message, or an item in it, is not valid | logs it; a task or transfer the item was about ends failed |
| `unknown_item` | both | an item type the receiver does not know (`item` says which) | logs it |
| `unknown_task` | both | a `cancel`, `chunk` or `ack` for a task or transfer the receiver does not have | ends that task or transfer failed |
| `too_large` | both | a message, chunk or file over the [limits](#limits) | ends the task or transfer it was about failed |
| `session_closed` | core | the session the message was sent under is [closed](../sessions/#session-lifetime) | starts over |
| `session_replaced` | core | another process claimed the [persisted session](../sessions/#persisted-sessions) | starts over, without claiming it |

Only `session_closed` and `session_replaced` end a session; every other code
is about one message or item, and the session goes on. A frame that fails to
open gets no `err`: the receiver cannot tell who sent it. What a minion does
when an exchange fails is in [Sessions](../sessions/#when-an-exchange-fails).

## Limits

| | |
|---|---|
| A message (plaintext) | 768 KiB: sealed and packed, it fits the HTTP channel's 1 MiB default `max_body_bytes` |
| Items in a message | 256 |
| Elements of an array or map inside an item (a result's `data`) | 65 536 |
| Nesting | 16 levels |
| A chunk's data | 512 KiB |
| A file a minion sends core, or core sends a minion | 2 GiB by default (core's `MINION_FILE_MAX_SIZE`) |
| A file streamed either way | none: core holds a few chunks of it at a time |
| A task's output and data kept | 4 MiB together; its listings go to the [file browser](../../file-browser/) apart |
| Core's memory of message ids | 24 hours |
| Task ids a minion remembers | 24 hours |

Session timings (the first check-in, tombstones, replaced keys, the
backstop) are in [Sessions](../sessions/).

Example sizes, CBOR plaintext → sealed → packed by the HTTP channel:

| Message | CBOR | JSON, for comparison | On the wire |
|---|---|---|---|
| empty check-in (busy) | 24 B | 39 B | 99 B |
| check-in asking for one task | 49 B | 75 B | 131 B |
| `hello` | 181 B | 246 B | 259 B |
| reply with two tasks | 165 B | 243 B | 243 B |
| ack and one result with 17 bytes of output | 148 B | 237 B | 227 B |

## Open questions

- **Keys per direction.** One key pair serves both directions, and the
  direction byte stops reflection. Separate pairs would limit what one leaked
  direction exposes, at the cost of four keys per build.
- **Compression.** Compressing before encrypting saves bytes on text output,
  but leaks through sizes when attacker-chosen data shares a message with
  secrets. Left out unless a command asks for it.

## Design notes

- **Why CBOR.** Messages are designed like JSON, but files, screenshots and
  raw command output travel as bytes: no base64 inside the encryption, and
  none outside it either, since the sync call carries the ciphertext raw. The
  subset above converts to JSON and back, so core can show any message to
  operators as JSON.
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
  apart from direction, so the same formats serve a channel, where the minion
  starts, and a dialer, where core does.
- **Why no time in messages.** Core trusts only its own clock, so it stamps
  messages as they arrive. The sync call is request and response, so a
  minion needs no clock either to know a reply is fresh: it matches `re`.
