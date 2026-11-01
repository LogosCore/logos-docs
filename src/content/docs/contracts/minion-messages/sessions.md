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
  11: tstr,             ; machine_id: what tells this machine apart, see
                        ;   Machine identity
  ? 4: tstr,            ; host: the host name
  ? 5: tstr,            ; user: as the OS reports it, e.g. "CORP\\svc_backup"
  ? 6: tstr,            ; domain: the host's Windows domain or workgroup
  ? 7: tstr,            ; proc: the process's image file name
                        ;   ("svchost.exe"), no path
  ? 8: "low" / "medium" / "high" / "system" / "root" / "user",  ; integrity
  ? 9: [* tstr],        ; addrs: local IP addresses
  ? 10: tstr,           ; version: the minion implementation's own version
  ? 12: { * tstr => any },  ; x: the factory's own fields, text keys
  ? 13: bstr .size 16,  ; sid: the persisted session the build claims
  ? 14: { sleep },      ; sleep: the check-in schedule it starts with
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
always knows them (`machine_id` falls back as far as a random id). Core still
takes a `hello` without `machine_id` from minions built before it was asked
for. The rest are optional: a minion cannot always learn its host or user (in
a sandbox, say).

- `os` and `arch` use the vocabulary of build platforms, so core shows them
  beside the build's platform and flags a mismatch (a 32-bit build on a
  64-bit OS).
- `integrity` is the Windows integrity level (`low`, `medium`, `high`,
  `system`), or elsewhere `root` or `user`.
- A factory's own fields go under `x`, so a key core adds later never
  collides with one of them; its build schema may declare them, so the web
  app can label them.

**A `hello` under the session id** (a *rehello*) replaces what core recorded
of the host and process, and gets `hello_response` with the same session id.
A minion may send one whenever they change (BOB's does not). A `rehello` item, core asking a minion
for a new `hello`, is **planned**, not built.

## Machine identity

Host and user do not tell machines apart: two machines named `work`, each
with a `user`, are common (cloned VMs, a naming standard). So every `hello`
says **`machine_id`**, a string `"<source>:<value>"`: lowercase, at most 256
characters, no spaces or control characters in the value. The source says
where the value came from, so two sources never collide by chance and an
operator sees what kind of identity it is. Core checks the shape only, and
the [file browser](../../file-browser/) keys a machine's files by it; a
factory may use a source of its own.

A minion takes the **first** of these it can read **quietly**, skipping
placeholders:

| | Source | Where | Notes |
|---|---|---|---|
| 1 | `smbios-uuid` | Linux `/sys/class/dmi/id/product_uuid` (root only); Windows `GetSystemFirmwareTable("RSMB")`, the SMBIOS system UUID | The hardware's or the VM's: survives reinstalls. Not through WMI on Windows: watched. |
| 1 | `mac-platform-uuid` | macOS `IOPlatformUUID`, through IOKit | Not by running `ioreg`. |
| 1 | `bsd-host-uuid` | FreeBSD `kern.hostuuid` | |
| 2 | `container` | the container's id, from `/proc/self/mountinfo` or the cgroup | Inside a container only, and before 3: an image's install id is every container's. |
| 3 | `linux-machine-id` | `/etc/machine-id`, else `/var/lib/dbus/machine-id` | Any user can read it. New with each install; shared by clones that did not regenerate it. |
| 3 | `win-machine-guid` | `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` | New with each install or sysprep; shared by clones made without sysprep. |
| 4 | `domain-sid` | a domain-joined Windows machine's computer account SID | |
| 5 | `hostname` | the host name | Does not tell apart the machines this is for, but stays the same. |
| 6 | `kept` | a random id the minion generates once and keeps | Names the minion's install, not the machine, and leaves a file or key on the host: only where the factory accepts that. |
| 7 | `ephemeral` | a random id for this process | Tells nothing apart across restarts; core can tell it from the source. |

- **Placeholders** are firmware values boards ship with instead of their own,
  shared by many machines: all zeros, all `F`s,
  `03000200-0400-0500-0006-000700080009`, or text such as "To be filled by
  O.E.M.", "Default string", "Not Settable". A minion skips them as if there
  were none. The protocol package has the list (`PlaceholderMachineUUID`)
  and builds the value (`MachineID`).
- **Not identities**, whatever they look like: `/proc/sys/kernel/random/boot_id`
  (new each boot), a network card's MAC address (randomized, or changed with
  the card), a volume's serial (copied with the disk image).

BOB's minion, on Linux: the firmware's UUID when it runs as root, else the
container's id when in one, else the machine id, else the host name, else a
random id for the process. It keeps none of its own: it leaves nothing on
the host.

## Session lifetime

- A session waits **one day** for its **first check-in** (its first request
  under the session id). One nobody checks in to within the day is
  **closed**.
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
missed three, by the schedule the minion says it keeps.

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
Sessions page, "Last seen" is green while a session is on time, yellow once
it is late and red once it is lost, and its filter picks any of the three.

## When an exchange fails

A session's keys live only in the process that staged it, so starting over
never mends a failure on the way: it only leaves a dead session behind. A
minion keeps its session through everything but a word from core:

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
