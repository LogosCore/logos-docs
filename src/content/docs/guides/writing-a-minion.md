---
title: "Writing a Minion"
---

A minion is the program a factory builds: it runs on a host, reaches core
through a channel, and runs the tasks operators give it. It talks to core
in [minion messages](../../contracts/minion-messages/): CBOR maps of
numbered items, sealed with its keys, which the channel carries without
reading. This guide says what a minion has to implement, walks through the
smallest one that works, and points at the Go helpers and at three minions
to read: BOB's, Raven's and Dumbo's. [Writing a Factory](../writing-a-factory/)
covers the factory that builds it.

Everything a minion knows of its build comes from its factory, built in:
its build id, its keys, its connections in the order it tries them (each
one's channel settings, the factory's own parameters for it, and its
largest message), the numbers (`op`) of the commands it has, and what its
schema declares (`max_tasks`, compression, a persisted session, failover).
A factory that declares `minion_config` gets all of it from core as one
numbered blob ([The minion
config](../../contracts/minion-build/#the-minion-config)).

## What a minion implements

Three tiers, each checked against the protocol package and core: what every
minion does, what its build asks of it, and what it may leave out.

### Always

| Implement | The rule | Where |
|---|---|---|
| Its channel's framing | Each message travels as its channel's transport carries one, with the id it is sent under (the build id, a temporary id or the session id) beside the sealed frame, never inside it ([below](#each-channels-framing)). | the channel |
| The suite and the envelope | Its build's: core's CBOR envelope and the `aes-256-cbc-hmac-sha256` frame unless the build names `json` or a codec of its factory's. The tag covers the id the message goes under; a reply that does not open counts as no reply. | [Wire format](../../contracts/minion-messages/wire-format/#sealed-frame), [Codecs](../../contracts/minion-messages/codecs/) |
| Its first message: `stage` or `hello` | Under the build id, sealed with the build's keys, one item: a `stage` (an RSA-2048 public key and a correlation id; core answers with a temporary id and new keys, encrypted to that key), or a `hello`, which keeps the build's keys for the session. A suite of the factory's own may refuse staging. | [Staging](../../contracts/minion-messages/sessions/#staging) |
| The `hello`, alone | Under a temporary id or the build id core takes one item, the `hello`; anything with it gets `bad_message`. It says `os` and `arch` in Go's names (required), and the machine id and `pid` where the minion has them. `hello_response` gives the session id: every message after goes under it, sealed with the session's keys (the new ones, or the build's when it skipped staging). | [Hello](../../contracts/minion-messages/sessions/#hello) |
| `get_tasks` | Tasks come only in answer to a message with a `get_tasks`, one a message. Through a call its `max` bounds that reply's tasks (absent: 32 at most); on a persistent connection it is a standing allowance, and `max` 0 pauses. It never goes beside a first `hello`, but in a `bind-call` page's answer to `rehello`. | [Asking for tasks](../../contracts/minion-messages/tasks-and-results/#asking-for-tasks) |
| Tasks by number | A `task` names its command by the schema's `op` and each arg by its param's `num`, defaults filled in, each in its type's CBOR form. A command the minion lacks, an `op` it does not know or an arg it cannot read ends the task: a `result` `{done: true, ok: false, err}`. | [Tasks](../../contracts/minion-messages/tasks-and-results/#tasks) |
| `ack` | Every task it receives, in its next message, in the order it took them: until the ack (or a result of the task) comes, core sends the task again with every `get_tasks`. Core counts a task running from its ack. | [Acknowledging](../../contracts/minion-messages/tasks-and-results/#acknowledging) |
| Each task once | It keeps the ids of the tasks it received in the last 24 hours and runs each once: a task can come twice (its ack, or the reply that carried it, lost on the way). A page that keeps nothing between calls cannot, and runs each task within the call that brings it. | [Tasks](../../contracts/minion-messages/tasks-and-results/#tasks) |
| `result` | A task's output in parts, `seq` from 0, the last with `done` and `ok` (`err` when not ok, `exit` for a process it ran); only the done part says `ok` and `exit`. A `cancel` stops the task, which still sends its done part; a `cancel` for a task it does not have gets an `err` `unknown_task` naming it. | [Results](../../contracts/minion-messages/tasks-and-results/#results), [Cancelling](../../contracts/minion-messages/tasks-and-results/#cancelling-a-task) |
| Starting over | On `err` `session_closed`: stage again, a new key pair and all. On `session_replaced`: the same, without claiming the persisted session. Any other `err` is about one item or message: the session goes on. | [When an exchange fails](../../contracts/minion-messages/sessions/#when-an-exchange-fails) |
| Items it does not know | An `err` `unknown_item` naming the item's place (`item`), in its answer or its next message; the rest of the message is taken. | [Changing these formats](../../contracts/minion-messages/#changing-these-formats) |
| Lost replies | An exchange is done on a sealed reply whose `re` is the message's `id`, or the channel's empty answer (core's 204). Otherwise the minion keeps its session and sends the items again: the same message (its `id` and bytes) within 10 minutes gets the reply core kept for it (64 KiB at most), or a new message under a new `id`, which every item allows. A `hello` under the build id goes again as the same message: a new one opens another session. | [Freshness and replay](../../contracts/minion-messages/wire-format/#freshness-and-replay) |
| The backstop | After 24 hours of nothing but failed exchanges, it starts over on its own: core cannot tell it about a session it no longer knows. | [When an exchange fails](../../contracts/minion-messages/sessions/#when-an-exchange-fails) |
| Message size | Each message within its connection's `max_message` as sent (768 KiB when the connection says none) and 768 KiB with its items inflated, 256 items at most: what is larger goes in parts (smaller chunks, listing pieces, result parts). | [Limits](../../contracts/minion-messages/wire-format/#limits) |

### When its build asks for it

| When | Implement | The rule | Where |
|---|---|---|---|
| The schema declares `max_tasks` | The operators' limit of tasks at once | The `hello` says the build's limit (key 17). Core's `max_tasks` item sets a new one: the minion says it back in its next message, at once, and asks for tasks within it (through a call, the room the limit leaves; on a persistent connection, the limit itself). 0 pauses. | [Max tasks](../../contracts/minion-messages/tasks-and-results/#max-tasks) |
| The schema declares `compression` and the build has it on | Packed items | It inflates each `packed` item core sends (raw DEFLATE) and takes the item inside in its place: one that does not inflate gets `bad_message`, one past the message's room `too_large`. Packing its own (256 B or more, an eighth smaller) is optional. | [Compression](../../contracts/minion-messages/wire-format/#compression) |
| The build has a persisted session | The claim | Its `hello` says the session's id (`sid`, key 13); `hello_response` says which session it got. Told `session_replaced`, it starts over without claiming. | [Persisted sessions](../../contracts/minion-messages/sessions/#persisted-sessions) |
| The build has more than one connection | `conn`, `conn_update` | The `hello` names the connection it came through (`conn`, its place from 1) when more than one of the build's could have carried it; moving to another, it says so in a `conn_update` sent over the new one. | [Connections](../../contracts/minion-messages/sessions/#connections) |
| The schema declares `failover` | Failover | It moves between its connections on its own as the build's policy says, each move a `conn_update`. | [Failover](../../contracts/channel-core-connections/#failover) |
| A command takes a `file` or `stream` param, or names a file action | File transfers | `chunk` and `ack` with `xfer`: in order from the receiver's `next`, the last chunk with the whole's SHA-256, each within the connection's room. | [File transfers](../../contracts/minion-messages/file-transfers/) |
| A command names a `result` | Its data | `data` in the result's shape, numbered; a `dir_listing` as listings on its result parts (`ls`). | [Task Results and Actions](../../contracts/task-results-and-actions/) |
| A command has the `tunnel` or `reverse_tunnel` action | Tunnel items | Items 21 to 28: streams opened, relayed with offsets and a window each way, and closed; an open with a key it does not know answered `unsupported`, never read as a plain connect. A tunnel task holds no place in its limit of tasks. | [Tunnels](../../contracts/minion-messages/tunnels/) |
| A command has the `delegate` or `reverse_delegate` action | Delegation | The `delegate` item (29), carrying another minion's traffic in the served channel's framing. | [Delegation](../../contracts/minion-messages/delegation/) |
| Its commands change who its work runs as | Identity | An `identity` item, in order with its acks. | [Identity](../../contracts/minion-messages/identity/) |
| A `bind-call` connection | Answering calls | It answers each call core makes (`re`). The first, under the build id, carries `rehello`: its `hello`, sealed with the build's keys, opens the session (no staging), and core takes the rest of that answer under the session. Keeping nothing between calls, it keeps its place in a `ctx` (a result part's: core answers with `resume`; a chunk's or an ack's: echoed). Against replays it checks `at` ([Optional](#optional)). | [bind-call minions](../../contracts/channel-core-connections/#bind-call-minions-when-core-calls), [Resuming a task](../../contracts/minion-messages/tasks-and-results/#resuming-a-task) |
| A `reverse-persistent` connection | A kept connection | Its first message links the connection to its session; core pushes over it (tasks within the allowance, cancels), and the minion acknowledges what came, answering with `re` or in its next message. It connects again when the connection drops. | [Connections](../../contracts/channel-core-connections/#get_tasks-on-a-persistent-connection) |
| A `bind-persistent` connection | Listening | It listens; once the channel dials, it speaks first (its `stage`, its `hello`, or a check-in under its session), then as over a kept connection. | [bind-persistent connections](../../contracts/channel-core-connections/#bind-persistent-connections-opening-and-closing) |

### Optional

| Item | Without it |
|---|---|
| The schedule: the `hello`'s `sleep`, a `sleep_update` when it changes | Core takes a minion on a reverse kind to check in once a day: its session goes late only after a day. With a schedule, late and lost follow it. |
| `poll` | The minion answers `unknown_item` and keeps its schedule. Streams and tunnels over `reverse-call` then go at its pace, not core's. |
| `reack` | It answers `unknown_item`, and core's tasks stay as they were; a `cancel` still ends one it lacks. Worth taking with a persisted session or a `bind-persistent` connection, where core asks. |
| `feedback` | Its operators see nothing of its troubles but the host's log. |
| `max_tasks` in the `hello` (a schema without the flag) | The session shows "max not reported". |
| The `hello`'s other fields: host, user, domain, process, integrity, addresses, version, `x` | Core shows what it was told. |
| A `hello` again under its session, when its host or process changes | Core keeps what the last one said. Core itself sends `rehello` today only as a `bind-call` page's first call. |
| Packing its own items | Its messages go unpacked. |
| Guarding against replays of core's messages: remembering their ids (BOB's minion keeps task ids for a day), or, keeping nothing (a page), refusing a message whose `at` is more than 10 minutes from its clock with `err` `stale` | Core does not rely on it: a captured core message sent to the minion again runs again ([Freshness and replay](../../contracts/minion-messages/wire-format/#freshness-and-replay)). |

## A reverse-call minion, step by step

The smallest minion that works: through the HTTP channel's `reverse-call`
kind, core's codec, staging. CBOR is shown in diagnostic notation, item
keys by number ([Registry](../../contracts/minion-messages/wire-format/#registry)).

1. **Read the build.** Its build id (16 bytes), its keys (`enc_key` and
   `mac_key`, 32 bytes each), its connection (for the HTTP channel:
   `base_url`, `request_timeout`, `checkin_interval`, `checkin_jitter`), and
   the `op`s of its commands.
2. **Stage.** Generate an RSA-2048 key pair and 16 random bytes, the
   correlation id. The message, with a fresh 16-byte `id`:

   ```cddl
   {0: 3, 1: h'<id>', 3: [{0: 1, 1: h'<public key, DER SubjectPublicKeyInfo>', 2: h'<corr>'}]}
   ```

   Encode it as CBOR, seal it with the build's keys under the build id,
   direction `0x01` minion → core ([Sealed
   frame](../../contracts/minion-messages/wire-format/#sealed-frame)), pack it
   for the channel (an offset byte, the ciphertext split around the build
   id) and send it in a request: any method, any path under `base_url`.
3. **Read the stage's reply.** A `200`: unpack it, check that the id is the
   build id, open the frame with the build's keys and direction `0x02`,
   decode it, and check `v` 3 and `re` = the message's `id`. Its
   `stage_response`, `{0: 2, 1: h'<temporary id>', 2: h'<keys>', 3:
   h'<corr>'}`: check `corr`, decrypt `keys` with the private key
   (RSA-OAEP, SHA-256), and read the new keys, CBOR `{1: enc_key, 2:
   mac_key}`.
4. **Say hello**, alone, under the temporary id, sealed with the new keys:

   ```cddl
   {0: 3, 1: h'<id>', 3: [{0: 3, 1: 4242, 2: "linux", 3: "amd64", 11: 4, 15: "<machine-id>", 14: {1: 60000, 2: 20}}]}
   ```

   (`pid`, `os`, `arch`, the machine id from `/etc/machine-id` as source 4,
   and its check-in schedule: 60 s, 20 % either way.) The reply's
   `hello_response`, `{0: 4, 1: h'<session id>'}`, is the session.
5. **Check in** under the session id, sealed with the new keys, taking one
   task at most:

   ```cddl
   {0: 3, 1: h'<id>', 3: [{0: 7, 1: 1}]}
   ```

   With nothing for the minion, core answers 204 and the HTTP channel `200`
   with 17 bytes: the offset byte `00` and the id. Otherwise the reply holds
   a task: `{0: 8, 1: h'<task id>', 2: 3}` (op 3, no args).
6. **Ack, run, answer.** The next message acks the task, carries its
   result, and asks for the next:

   ```cddl
   {0: 3, 1: h'<id>', 3: [
     {0: 11, 1: [h'<task id>']},
     {0: 10, 1: h'<task id>', 2: 0, 3: true, 4: true, 5: h'68656c6c6f0a'},
     {0: 7, 1: 1}
   ]}
   ```

7. **Go on.** Wait the check-in interval, spread by its jitter, or less
   while there is something to send; check in again. A failed exchange (no
   answer, a timeout, the channel's 404, a reply that does not open) keeps
   the session: the items go again at the next check-in. `session_closed`
   or `session_replaced` starts over at step 2; so do 24 hours of nothing
   but failures. An item the minion does not know gets `unknown_item`.

A minion that skips staging sends step 4 under the build id, sealed with
the build's keys, and keeps them for the session.

## The Go helpers

`logos-golang-protocol` (package `protocol`) has a minion's side as well as
core's; BOB's minion uses nothing else for its messages.

| Helper | Gives |
|---|---|
| `ReadMinionConfig` | A built-in [minion config](../../contracts/minion-build/#the-minion-config): `Build`, `Crypto` (`Keys()` for core's suite), `Connections` (each with `Params` and `Values` by number, `MessageLimit()`, `FailoverAuto()`), `Ops`, `MaxTasks`, `Compression`, `Session`, `Failover`, `Values`. |
| `SealFrame`, `OpenFrame` | The `aes-256-cbc-hmac-sha256` frame, under an id, in a direction (`FrameMinionToCore`, `FrameCoreToMinion`); `ErrFrame` for one that does not open. |
| `MarshalCBOR`, `UnmarshalCBOR` | CBOR as the wire format has it: shortest forms and definite lengths written, tags and repeated keys refused, the limits checked. |
| `MinionMessage`, `CoreMessage`, `NewMessageID`, `ValidateMessageHead`, `ItemType`, `ItemName` | The message, a fresh id, its head checked, an item's type and its name. |
| `StageItem`, `HelloItem`, `GetTasksItem`, `AckItem`, `ResultItem`, `ErrItem`, `TaskItem`, `CancelItem`, … | The items, each with `Validate`; `Item…` constants for their types, `ErrItem…` for err codes. |
| `DecryptStageKeys`, `StageKeySize` | The new keys of a `stage_response`, with the minion's RSA key. |
| `Pack`, `Unpack`, `UnpackItems` | Packed items; `PackIn` and `UnpackIn` under core's JSON envelope. |
| `ArgString`, `ArgInt`, `ArgBool`, `ArgNumber`, `ArgStrings`, `ArgStringMap`, `ArgDuration`, `ArgFile`, `ArgCredential`, `ArgCredentials` | A task's args, and a config's values, by number. |
| `MachineID`, `PlaceholderMachineUUID`, `MachineSMBIOSUUID`, … | The [machine id](../../contracts/minion-messages/sessions/#machine-identity): sources and the placeholders to skip. |
| `ReadTunnel`, `TunnelItem` and the other tunnel items | A tunnel open read strictly, and the stream items. |
| `StaleWindow`, `MaxMinionMessageSize`, `MaxTasksLimit`, `DefaultMaxTasks` | The limits a minion applies. |

## Each channel's framing

What a minion sends its channel, and what comes back. The channel never
opens the sealed frame.

| Channel | Kinds | A message | Nothing for the minion | A failure |
|---|---|---|---|---|
| HTTP (`http`, version 3) | `reverse-call`: a request per message, any method, any path; `reverse-persistent`: a WebSocket, a binary frame per message | `offset (1) ‖ part 1 ‖ id (16) ‖ part 2`, the ciphertext being part 1 and part 2, the offset random, 0 to 255 ([its README](https://github.com/LogosCore/logos-http-channel#wire-format)) | A `200` of 17 bytes: the offset `00` and the id. Over a WebSocket core always answers, with a sealed message, empty or not. | A plain `404`, whatever went wrong; a WebSocket closed with no reason |
| TCP (`tcp`, version 1) | `bind-persistent` (the minion listens), `reverse-persistent` and `reverse-call` (it dials) | `[length: 4 bytes, big-endian][id: 16 bytes][sealed frame]`, the length counting the id and the frame ([The TCP channel](../../contracts/channel-core-connections/#the-tcp-channel)) | `reverse-call`: the id alone (length 16), then the channel closes. Over a kept connection core always answers. | `reverse-call`: the connection closed with no reply |
| Dumbo (`dumbo`, version 1) | `bind-call`: the channel calls the page | The channel's request and the page's `200` answer, `application/octet-stream`, both `[id: 16 bytes][sealed frame]` | The page always answers. | The page answers anything it does not take with a plain `404`. |

## When it does not work

The channel says nothing to a minion about why: every failure looks the
same, so whoever probes it learns nothing. The reason is in the channel's
log, in core's log (its `minionsync` logger), or in a sealed `err` only the
minion can open. In the dev stack, `docker logs logos-http-channel` and
`docker logs logos-core-dev`.

| What happens | Where it shows | Why |
|---|---|---|
| Every request gets the HTTP channel's `404` | Channel: `outcome` `rejected_by_core`, `core_status` 403 | The channel instance is not registered with core, or is blocked. |
| Every request gets `404` | Channel: `outcome` `refused`, `core_status` 422. Core: "minion message under an unknown id" | Core knows no build, temporary id or session by that id: a build id core never made (a minion built from a test request), a deleted build, a temporary id past the 10 minutes after its hello, a session core forgot. |
| Every request gets `404` | Channel: `refused`, 422. Core: "minion message does not open" | The frame does not open: the keys of another id (the build's after staging, say), the wrong direction byte, a tag not computed over the id, bad padding. |
| Every request gets `404` | Channel: `refused`, 422. Core: "minion message is not CBOR" or "minion message head" | Not CBOR in the protocol's subset (an indefinite length, a tag, a key twice, invalid UTF-8), over 768 KiB, `v` not 3, both or neither of `id` and `re`, an id not 16 bytes, more than 256 items. |
| A message sent again gets `404` | Channel: `refused`, `core_status` 409. Core: "minion message replayed, refused" | Its `id` was seen and its reply is no longer kept (10 minutes, 64 KiB at most): send the items in a new message. |
| `404` | Channel: `bad_request` (stage `read body` or `unpack`), `too_large` | The framing: a body under 17 bytes, an offset past the ciphertext, a body over `max_body_bytes` (1 MiB by default). |
| `404` | Channel: `core_error` | Core cannot be reached. The minion keeps its session and tries again. |
| A sealed `err` `bad_message`, "under a build id the only item taken is one stage or one hello" | The minion's own log | Its first message carried more than one item. Under a temporary id: "the only item taken is one hello". |
| A sealed `err` `bad_message`, "hello: os is required" | The minion's own log | A `hello` without `os` or `arch`, or with a machine id's source and no value. |
| A sealed `err` `unknown_item`, "not taken under a session yet" | The minion's own log | An item core does not take from a minion: one of core's own direction (a `task`), or a `stage` under the session. |
| No task comes | Sessions: the session's tasks stay queued | No `get_tasks` in its messages, `max` 0, or its limit of tasks full: core counts a task from its ack to its done part. A command whose `kinds` exclude the connection's is refused when queued. |
| The same task comes again and again | The minion's own log | It never acks it. |
| Its session is closed a day after it opened | Sessions | Nothing came under the session id after the `hello`: its `hello_response` was lost and the minion started over. |
| Its session shows late or lost while it checks in | Sessions | The schedule its `hello` or `sleep_update` said is shorter than the one it keeps. |
| A `bind-call` target is refused or stale | The build's **Targets** tab | The page's word on core's call: no `hello` in its answer to `rehello`, an `err`, or `stale` (the page's clock and core's disagree). |

Testing against a stand-in saves a dev stack for the end: BOB's
`cmd/bob-factory/stage_test.go` runs the compiled minion against a fake HTTP
channel and core in one, which stages it, opens its session, fails a
check-in and closes the session.

## Examples

### BOB's minion

BOB's minion (`logos-bob-factory`, `minion/`) is a full minion in Go: every
connection kind but `bind-call`, staging, persisted sessions, max tasks,
compression, failover, file transfers and streams, listings and walks,
tunnels and terminals, delegation and feedback. It reads its config by
number and runs each task in a goroutine of its own.

| Files | What |
|---|---|
| `main.go` | The config read (`//go:embed minion.cfg`, `protocol.ReadMinionConfig`), staging, the `hello`, the check-in loop, starting over, the backstop. |
| `fields.go`, `ops.go`, `exits.go` | The numbers it reads its config, its tasks and its exit codes by, checked against BOB's schema by its tests. |
| `conns.go`, `ws.go`, `tcp.go`, `tcp_reverse.go`, `failover.go`, `pushqueue.go` | Its connections: HTTP requests and a WebSocket, the TCP channel's three kinds, switching and failover, what core pushes. |
| `tasks.go` | The runner: core's items dispatched, `get_tasks` within its limit, acks, result parts, cancels, `reack`, `max_tasks`. |
| `packing.go`, `feedback.go` | Compression; feedback. |
| `machine.go`, `machine_*.go`, `host_*.go`, `integrity.go`, `smbios.go` | The `hello`: the machine id, the host, the integrity level. |
| `download.go`, `upload.go` | File transfers both ways. |
| `walk.go`, `volumes.go`, `rm.go`, `shell*.go`, `paths*.go` | Its commands' work on the host. |
| `tunnel*.go`, `proc*.go`, `pipe_*.go`, `icmp_*.go`, `rtt.go` | Tunnels, terminals, named pipes, pings, and resend timing that follows the link. |
| `delegate.go`, `delegate_reverse.go` | Delegation. |

### Raven

Raven's minion (`logos-raven`, `cmd/raven-factory/raven.ps1`) is a
PowerShell script, a template its factory fills in: through the HTTP
channel's `reverse-call`, its `hello` under the build id (no staging), then
a `get_tasks` (4) with every check-in, each task acked and answered in the
next message, starting over on `session_closed` or `session_replaced`. It
speaks no CBOR and seals nothing: its envelope and suite are Raven's own,
which the factory translates for core ([Raven: the test
factory](../../contracts/minion-messages/codecs/#raven-the-test-factory)).
It exists to test codecs, and protects nothing.

### Dumbo

Dumbo's page (`logos-dumbo`, `cmd/dumbo-factory/page.php`) is a `bind-call`
minion: a PHP file on a web server, with its CBOR, AES and HMAC written in
PHP. It keeps nothing between requests: it answers core's first call
(`rehello`) with its `hello` under the build id, runs each task within the
call that brings it (acked and answered at once), asks for 4 tasks in every
answer, refuses a call whose `at` is more than 10 minutes off, answers
items it does not take with `unknown_item`, and carries walks and files
across calls in a `ctx` that core gives back.
