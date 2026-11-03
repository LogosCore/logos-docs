---
title: "Sessions"
---

Every **new process** of a build ends up in a **session** of its own before
it does anything else. A session is what operators see in the Sessions page,
and what tasks are given to. This page covers how a process gets one (staging
and `hello`), what identifies its machine, how long a session lives,
persisted and late sessions, and what a minion does when an exchange fails.

## Staging

A process normally stages first, and the id its messages are sent under
changes twice on the way:

| Step | Request sent under | Sealed with | Item | Core answers |
|---|---|---|---|---|
| 1. Stage | build id | the build's own keys | `stage` | `stage_response`: a temporary id and new keys |
| 2. Hello | temporary id | the new keys | `hello` | `hello_response`: a session id |
| 3. Everything after | session id | the new keys | anything | as each item says |

A build may also **skip staging** and say `hello` straight under the build
id. The session then keeps the build's own keys:

| Step | Request sent under | Sealed with | Item | Core answers |
|---|---|---|---|---|
| 1. Hello | build id | the build's own keys | `hello` | `hello_response`: a session id |
| 2. Everything after | session id | the build's own keys | anything | as each item says |

- **All three ids are UUIDv4s** and travel the same way: the transport
  carries the id where it carries a build id (for the HTTP channel, 16 bytes
  in its [packed format](https://github.com/LogosCore/logos-http-channel#wire-format)),
  and the channel passes it to core in `Logos-Build-Id`. Channels never know
  staging exists. Core finds the keys by the id: a session's, a temporary
  id's or a build's.
- **Under a build id** core takes only `stage` or `hello`; **under a
  temporary id** only `hello`. Anything else there gets `bad_message`.
- **A build's own keys stay valid** after staging: the same build may run as
  several processes, on one host or several, and each stages on its own.

### Stage

```cddl
stage = {
  0: 1,                 ; t: stage
  1: bstr,              ; key: the minion's RSA-2048 public key, DER
                        ;   SubjectPublicKeyInfo
  2: bstr .size 16,     ; corr: correlation id, random
}

stage_response = {
  0: 2,                 ; t: stage_response
  1: bstr .size 16,     ; tid: the temporary id, a UUIDv4, raw bytes
  2: bstr,              ; keys: new key material for the build's suite,
                        ;   encrypted with RSA-OAEP (SHA-256) under the key
                        ;   from stage
  3: bstr .size 16,     ; corr: the correlation id from stage
}

stage-keys = {          ; aes-256-cbc-hmac-sha256's key material, as keys
  1: bstr .size 32,     ;   holds it (encrypted): enc_key
  2: bstr .size 32,     ; mac_key
}
```

1. At start, the minion generates its own **RSA-2048 key pair**; the private
   key never leaves the process. It picks a random **correlation id**.
2. It sends a request whose only item is `stage`, under its build id, sealed
   with the build's own keys: only a minion of that build can stage.
3. Core generates **new key material** for the build's suite (for
   `aes-256-cbc-hmac-sha256`, a new `enc_key` and `mac_key`, 32 random bytes
   each), picks a **temporary id**, and keeps both for **one day**.
4. Core answers with the temporary id, the key material **encrypted with the
   minion's public key**, and the correlation id.
5. The minion checks the correlation id and decrypts the key material: for
   this suite, the CBOR map `stage-keys`, 71 bytes, well within
   one RSA-2048 OAEP operation (190 bytes at most).

### Hello

```cddl
hello = {
  0: 3,                 ; t: hello
  1: uint,              ; pid
  2: tstr,              ; os: GOOS-style, "windows", "linux", "darwin"
  3: tstr,              ; arch: GOARCH-style, "amd64", "arm64", "386"
  11: uint,             ; machine_id's source: where its value came
                        ;   from, see Machine identity
  15: tstr,             ; machine_id's value
  ? 4: tstr,            ; host: the host name
  ? 5: tstr,            ; user: as the OS reports it, e.g. "CORP\\svc_backup"
  ? 6: tstr,            ; domain: the host's Windows domain or workgroup
  ? 7: tstr,            ; proc: the process's image file name
                        ;   ("svchost.exe"), no path
  ? 8: uint,            ; integrity: low 1, medium 2, high 3, system 4,
                        ;   root 5, user 6
  ? 9: [* bstr],        ; addrs: local IP addresses, raw, 4 bytes or 16
  ? 10: tstr,           ; version: the minion implementation's own version
  ? 12: { * tstr => any },  ; x: the factory's own fields, text keys
  ? 13: bstr .size 16,  ; sid: the persisted session the build claims
  ? 14: { sleep },      ; sleep: the check-in schedule it starts with
  ? 16: uint,           ; conn: the connection it says hello through,
                        ;   its place in the build's connections, from 1
}

sleep = (
  1: uint,              ; interval: milliseconds between check-ins
  2: uint,              ; jitter: spread either way, percent of interval,
                        ;   0 to 100
)

hello_response = {
  0: 4,                 ; t: hello_response
  1: bstr .size 16,     ; sid: the session id, a UUIDv4, raw bytes
}
```

1. The minion sends its `hello` under the temporary id, sealed with the new
   keys (or, skipping staging, under the build id with the build's own keys).
   It may ask for tasks in the same request ([`get_tasks`](../tasks-and-results/#asking-for-tasks)).
2. Core creates a **session**, gives it those keys, and records the host and
   process. A temporary id serves one `hello`: its entry goes at once.
3. Core answers with `hello_response`: the **session id**. Every message after
   that is sent under the session id and sealed with the session's keys, for
   as long as the process runs.

**The fields.** `pid`, `os`, `arch` and `machine_id` are required: a minion
always knows them (`machine_id` falls back as far as a random id); core takes
a `hello` without a machine id all the same. The rest are optional: a minion
cannot always learn its host or user (in a sandbox, say). Core keeps and
shows the numbered values by name: the integrity level, the machine id as
`"<source>:<value>"`, the addresses as text.

- `os` and `arch` use the vocabulary of build platforms, so core shows them
  beside the build's platform and flags a mismatch (a 32-bit build on a
  64-bit OS).
- `integrity` is the Windows integrity level (`low`, `medium`, `high`,
  `system`), or elsewhere `root` or `user`. A level core does not know shows
  as its number.
- `conn` names the connection the minion uses by its place in the build's
  connections (1 for the first): a minion carries no connection names, and
  core knows each one's name, kind and channel from the build. When it
  moves to another, it says so with a [`conn_update`](#connections).
- A factory's own fields go under `x`, so a key core adds later never
  collides with one of them; its build schema may declare them, so the web
  app can label them.

**A `hello` under the session id** (a *rehello*) replaces what core recorded
of the host and process, and gets `hello_response` with the same session id.
A minion may send one whenever they change (BOB's does not on its own).

```cddl
rehello = { 0: 6 }      ; t: rehello (core → minion)
```

The **`rehello` item** asks a minion for a `hello`. Core sends it as a
`bind-call` minion's first call, under the build id, and the page's
`hello`, sealed with the build's keys, opens its session ([bind-call
targets](../../channel-core-connections/#bind-call-minions-targets-and-sessions)).
Under a session it asks for the host and process again: a minion that
starts its exchanges says its `hello` in its next message (BOB's does,
through the connection in use).

## Machine identity

Host and user do not tell machines apart: two machines named `work`, each
with a `user`, are common (cloned VMs, a naming standard). So every `hello`
says a **machine id**: a source, by number, and a value. Core keeps it as
`"<source>:<value>"`, the source by name and the value lowercased, at most
256 characters, no spaces or control characters. The source says where the
value came from, so two sources never collide by chance and an operator sees
what kind of identity it is. The [file browser](../../file-browser/) keys a
machine's files by it.

Which sources a minion reads, and in which order, is **its factory's
choice**: core checks only the shape. What follows is a recommendation. A
factory that reads a source not listed asks for a number in the registry,
and core shows one it does not know as `source-<n>`.

The recommendation rests on two rules:

- **The same machine, the same id, whoever runs the minion.** Every source
  is one **any user** can read: none needs root or an administrator. Two
  minions on one host, one as root and one as a user, must not look like two
  machines: the file browser keys a machine's files by its id.
- **Quietly**: read a file, a registry value or a system call, nothing run,
  nothing that a monitor watches or that reaches the network.

A minion takes the **first** of these it can read, skipping placeholders:

| | Source | No. | Where | Notes |
|---|---|---|---|---|
| 1 | `smbios-uuid` | 1 | Windows `GetSystemFirmwareTable("RSMB")`: the SMBIOS system UUID | The hardware's or the VM's: survives reinstalls. Not through WMI: watched. Not on Linux, where the firmware's UUID (`/sys/class/dmi/id/product_uuid`) is root's only. |
| 1 | `mac-platform-uuid` | 2 | macOS `IOPlatformUUID`, through IOKit | Not by running `ioreg`. |
| 1 | `bsd-host-uuid` | 3 | FreeBSD `kern.hostuuid` | |
| 2 | `container` | 6 | the container's id, from `/proc/self/mountinfo` or the cgroup | Inside a container only, and before 3: an image's install id is every container's. |
| 3 | `linux-machine-id` | 4 | `/etc/machine-id`, else `/var/lib/dbus/machine-id` | New with each install; shared by clones that did not regenerate it. |
| 3 | `win-machine-guid` | 5 | `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`, from the 64-bit view | New with each install or sysprep; shared by clones made without sysprep. A 32-bit process reads it with `KEY_WOW64_64KEY`. |
| 4 | `hostname` | 8 | the host name | Does not tell apart the machines this is for, but stays the same. |
| 5 | `kept` | 9 | a random id the minion generates once and keeps, in a place every user shares and can read (`/var/tmp`, `C:\ProgramData`) | Names the minion's install, not the machine, and leaves a file or key on the host: only where the factory accepts that. Never under a user's home: each user's minion would make its own. |
| 6 | `ephemeral` | 10 | a random id for this process | Tells nothing apart across restarts; core can tell it from the source. |

- **Placeholders** are firmware values boards ship with instead of their own,
  shared by many machines: all zeros, all `F`s,
  `03000200-0400-0500-0006-000700080009`, or text such as "To be filled by
  O.E.M.", "Default string", "Not Settable". A minion skips them as if there
  were none. The protocol package has the list (`PlaceholderMachineUUID`),
  the sources' numbers (`MachineSMBIOSUUID`, …) and core's joined form
  (`MachineID`).
- **Not recommended**: sources only a privileged process reads (Linux's
  firmware UUID and serials, `/sys/firmware/dmi`), and a domain machine's
  computer account SID (`domain-sid`, number 7): reading it means asking LSA
  or a domain controller, and on Windows `win-machine-guid` always comes
  first. Their numbers stay in the registry.
- **Not identities**, whatever they look like: `/proc/sys/kernel/random/boot_id`
  (new each boot), a network card's MAC address (randomized, or changed with
  the card), a volume's serial (copied with the disk image).

BOB's minion, on Linux: the container's id when in one, else the machine
id, else the host name, else a random id for the process; the same as any
user. It keeps none of its own: it leaves nothing on the host.

## Session lifetime

- A session waits **one day** for its **first check-in**: its first request
  under the session id, the proof that the minion got its session id. One
  nobody checks in to within the day is **closed** (its `hello_response` was
  lost, say, and the minion staged again). A `bind-call` page's session is
  checked in by the `hello` that opens it: the page answered core's own
  call, so core holds the session's id and nothing can lose it, and a page
  given nothing to do for a day stays open.
- After its first check-in, a session lives **as long as core keeps it**: it
  does not expire.
- Core **closes** a session that expired waiting, and every session of an
  operation that is deleted. A closed session is gone from the operation, but
  core keeps its id and keys for **30 days** (a **tombstone**): a message
  under it still opens, and core answers with a sealed `err`
  `session_closed`. After 30 days core forgets it, and its messages no longer
  open.
- A new process of the build starts over, with a new session, unless its
  build has a persisted session.

## Persisted sessions

A minion whose host reboots starts again, and would open a new session each
time. An operator who wants it back in the same session builds it **with a
persisted session**. Factories that support it say so in their [build
schema](../../minion-build/#the-build-schema) (`persisted_sessions`); core
gives the factory the session id in the build request (`session_id`), and the
factory builds it into the minion. One persisted session per build, chosen
when the build is made:

- **A new persisted session.** Core **reserves** a session id with the build.
  A reserved session has no keys, host or number yet and is not in the
  operation's sessions; the minion's first `hello` claims it, and it opens
  there like any session. A reservation does not expire (a build may be
  deployed weeks later); it goes with its build, or its operation, while
  unclaimed.
- **An existing session**: "Build with persisted session" on a session, or
  "Build again" from a build that persists one. The new build's minion takes
  the session over when it starts, replacing the process there.

How a claim works:

1. The minion stages as always, then **claims** the session: its `hello`
   carries `sid`, the persisted session's id.
2. Core honours the claim when the message is from the build that names the
   session (under that build's temporary id, or straight under its build id)
   and the session is open. The session **takes the claim's keys** (the new
   ones from the stage, or the build's own) and the `hello`'s host and
   process; core answers `hello_response` with the claimed `sid` and records
   the restart. No session keys are built into a minion: only the build's
   own, as always.
3. A claim core does not honour (the session closed, of another build, or
   unknown) **opens a new session** instead, as a `hello` without `sid` does:
   the minion works, and `hello_response` says which session it got.
4. **One holder at a time; the newest claim wins.** The process that held the
   session before still opens its next message with the keys it has: core
   keeps a session's last 4 replaced keys for 30 days. It answers, sealed,
   `err` `session_replaced`. That process starts over **without claiming**,
   in a session of its own, so two copies of a build never take the session
   from each other in turn.

## Late and lost sessions

Core marks a session **late** when it missed a check-in, and **lost** when it
missed three, by the schedule the minion says it keeps. What a check-in is
depends on the minion's connection:

| Connection | A check-in | Late and lost |
|---|---|---|
| `reverse-call` | each message the minion sends | by its schedule |
| `reverse-persistent` | each message, and the open connection itself (its pings) | while connected, never; after, from when it closed, by its schedule: how soon it will be back |
| `bind-call` | each call that reaches the page | by its schedule, when the page says one (core then calls on it); never without one |
| `bind-persistent` | each message, and the open connection itself | never: the connection says whether the minion is there (connected, not connected on purpose, unreachable since) |

A minion that moves to a `bind-persistent` connection stops being late;
one that moves off it is late again by its schedule from its next
check-in.

```cddl
sleep_update = { 0: 5, sleep }   ; t: sleep_update
```

- The minion says its schedule in its `hello` (`sleep`), and again with a
  `sleep_update`, in any message, whenever it changes (a task that changes
  how long it sleeps, say). A rehello may carry it too.
- On every check-in, and on every schedule, core sets the session's
  **`late_at`**: the last check-in (the `hello`'s time before the first) plus
  the interval stretched by its jitter, plus 30 seconds of grace for slow
  networks. A session is late once the time is past `late_at`.
- With it core sets **`lost_at`**: the last check-in plus three intervals
  stretched by their jitter, plus the same grace. A minion that sleeps an
  hour is lost after about three hours; one that checks in every second,
  after about half a minute.
- A session whose minion never said its schedule is neither: core does not
  guess.

Late and lost only describe a session: it stays open, nothing is sent to its
minion, and a lost minion that checks in again is on time at once. In the
Sessions page, "Last seen" is green while a session is on time or connected
(a persistent connection serving it open), yellow once it is late and red
once it is lost, and its filter picks any of the three: "on time or
connected", "late", "lost". Core records a session connected when its first
persistent connection opens and clears it when its last closes, and as core
starts, since the connections went with the process before.

## Connections

A minion built with several connections uses one at a time, and says which:
in its `hello` (`conn`), and with a `conn_update` whenever it moves to
another, whatever moved it: an operator's [`switch_connection`](../../task-results-and-actions/#switch_connection),
a fallback after failures, its own logic.

```cddl
conn_update = {
  0: 14,                ; t: conn_update
  1: uint,              ; conn: the connection it uses now, its place in
                        ;   the build's connections, from 1
  ? 2: tstr,            ; reason: why, at most 256 bytes
                        ;   ("operator", "fell back after 5 failures")
}
```

- The message carrying it goes **over the new connection**: core learns of
  the move from a message that came through it.
- Core keeps the connection in use on the session, and the moves it
  reported, the latest 32, with when, from which, to which and why. The
  session's view lists the build's connections with the one in use, and a
  **Switch to** button on each other one when the minion has a command for
  `switch_connection`.
- The session, its keys and its schedule stay the same whichever connection
  carries it. A rehello through another connection moves `conn` too, without
  a change recorded.

## When an exchange fails

A session's keys live only in the process that staged it, so starting over
never mends a failure on the way: it only leaves a dead session behind. A
minion that starts its exchanges (every kind but `bind-call`) keeps its
session through everything but a word from core. A `bind-call` page starts
nothing: a call that fails is core's to retry ([bind-call
minions](../../channel-core-connections/#bind-call-minions-when-core-calls)).
Over a persistent connection, a failure is the connection dropping: the
minion connects again (`reverse-persistent`) or waits for core's next dial
(`bind-persistent`), in the same session.

| The minion gets | It means | The minion |
|---|---|---|
| no reply, a timeout, a refused connection | the channel cannot be reached | keeps the session, and checks in on its schedule |
| any failure from the channel (the HTTP channel's 404) | something failed on the way: core down, the channel not registered, a message core did not accept | keeps the session |
| a sealed reply with `err` `session_closed` | core closed the session | starts over |
| a sealed reply with `err` `session_replaced` | another process claimed the persisted session | starts over, without claiming |
| a sealed reply with another `err` | core refuses something in the message | keeps the session, and logs it |
| a sealed reply | all is well | carries on |

- **The channel never says why.** A message core does not open (an unknown
  id, a frame that fails its checks), a replayed one, and every trouble
  between the channel and core look the same to the client: for the HTTP
  channel, a 404, as for any request that is not a minion message at all.
  Whoever probes a channel learns nothing from the answers. What core has to
  tell a minion, it tells inside a sealed reply, which only the minion can
  open and nobody can forge.
- **The backstop.** Core cannot speak about a session it no longer knows (one
  forgotten after its 30 days, or lost with core's data). So a minion whose
  exchanges have **all failed for 24 hours** starts over on its own.
- **Starting over** is staging again from the beginning: a new key pair, a
  new correlation id, a new `stage` (or a new `hello` under the build id). A
  failed stage or `hello` is tried again on the minion's schedule, with a new
  key pair each time.

## Timings

| | |
|---|---|
| A temporary id and its keys | 1 day, or until its `hello` |
| A session's first check-in | within 1 day, or it is closed |
| A closed session's tombstone | 30 days |
| A persisted session's replaced keys | 30 days, the last 4 |
| Late and lost grace | 30 seconds |
| A minion's backstop | 24 hours of failed exchanges, then it starts over |

## Design notes

- **Why staging hands out new keys.** A staged process talks under keys that
  never left core except encrypted to that process's own RSA key: whoever
  reads the keys out of an artifact can stage on their own, but cannot open
  a staged session's messages. A session that skipped staging uses the
  build's own keys, so anyone with the artifact can read it: skipping trades
  that protection for one round trip less and no RSA in the minion.
- **Why the temporary id is a UUIDv4.** It takes the build id's place in the
  transport and in `Logos-Build-Id`, so channels and channel-core carry it
  without knowing staging exists.
- **Why a machine id, not the host.** Sessions come and go (restarts,
  persisted sessions replaced, a second implant on the same host); the
  machine stays. The file browser keeps one snapshot per machine because of
  it.
