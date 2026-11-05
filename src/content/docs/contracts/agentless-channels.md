---
title: "Agentless Channels"
---

:::caution[Draft]
An agreed design, not built yet. The first agentless channel is the SSH
module (`logos-ssh`): an SSH factory and an SSH channel that reach SSH
servers with nothing installed on them.
:::

A channel normally carries a minion's sealed messages without reading them:
the minion runs on the target, and core is its peer. An SSH server runs no
minion and speaks no Logos. An **agentless** channel acts as the minion
itself: it takes core's messages, does their work over the target's own
protocol (for SSH: commands in exec channels, files over SFTP), and answers
as a minion would. Core sees a minion behind a `bind` channel, the server
sees a client of its own protocol, and nothing is installed on the server.

```mermaid
sequenceDiagram
    participant C as Core
    participant CH as SSH channel (the minion)
    participant S as SSH server
    C->>CH: call {target's values, rehello, the build's keys}
    CH->>S: SSH login (a password or a key)
    CH->>S: uname, id; /etc/machine-id over SFTP
    CH->>C: answer {hello}
    C->>CH: call {task: ls /etc}, under the session id
    CH->>S: SFTP: read the directory
    CH->>C: answer {result: dir_listing}
```

| Part | What changes |
|---|---|
| Protocol | `agentless` on a `bind` kind of a connection schema; `keys` (key 11) on a call or an open to such a kind: the keys of its id; an `open`'s `under` (key 10): the id the minion speaks under; the link failure kinds `login` (5) and `host_key` (6); the machine id source `ssh-host-key` (11); a hello's `pid` optional (0: no process of its own) |
| Core | a call or an open to an agentless kind carries its id's keys (the build's under the build id, the session's under the session id); an `open` says the id the minion speaks under (core never speaks first); the session's connection taken from its target; the failures `login` and `host_key` shown as refused, not retried, for calls and opens |
| SSH module | `logos-ssh`, new: the `ssh` factory, and the `ssh` channel with its own minion (for calls as the Dumbo page answers, for a persistent connection as a listening minion) |
| Unchanged | Targets and their states, sessions, tasks, results, file transfers, streams, the file browser, the console |

## Keys for the channel

Every build is sealed the same way, whatever its channel: a factory
declares its suite (`aes-256-cbc-hmac-sha256`), core generates each build's
keys, and core seals every message with the keys of the id it goes under.
What an agentless kind changes is who opens the messages at the other end:

- **The keys go with every call and open.** A `call` or an `open` to an
  [agentless kind](#agentless-kinds) carries `keys` (key 11): the suite and
  the keys of its id (the build's under the build id, the session's under
  the session id; an `open`'s are those of its `under`). The channel opens
  core's message and seals the minion's answer with them, as a minion
  would. It keeps nothing between calls, so they come every time.
- **Only to agentless kinds.** Any other channel never sees a key, and
  relays sealed frames it cannot read, as channels do. A channel from
  before `keys` decodes the frame and skips the key.
- **A minion that does not stage keeps its build's keys** as its
  session's: the SSH minion's session keys are its build's, and the
  factory's artifact holds none of them (core keeps them).
- **Everything else is unchanged in core**: the same sealing, the same
  sessions, the same checks, for a page and for an SSH server alike.

The seal does two things: it hides a message, and its HMAC shows that the
minion sent it, since ids travel in the clear. Between core and an
agentless channel, which holds the keys, the seal hides nothing from the
channel; it still means only a holder of the keys (core and that channel)
can speak under a build's or a session's id.

## Agentless kinds

A channel says it per kind, in its [connection schema](../minion-connection/#the-schema):

```json
"bind-call": { "agentless": true, "fields": [ "call_reuse" ], "target": [ "host", "port", "user", "…" ] }
```

- **`agentless`**: optional, `false` by default, for `bind-call` and
  `bind-persistent` only (core refuses it on a `reverse` kind). It means
  the channel answers for the minion: no minion runs on the target, and the
  channel reads and writes the messages of that kind. Core therefore gives
  it the keys of each call's and open's id ([keys](#keys-for-the-channel)):
  that is all `agentless` changes in what core does.
- **`fields`** are what a build's connection gives the channel (how it
  calls), kept in endpoints as for any `bind` kind; nothing is built into
  a minion, as there is none. **`target`** is what each target gives it.

On such a kind:

- **`bind-call`** goes as for a page ([targets and sessions](../channel-core-connections/#bind-call-minions-targets-and-sessions),
  [when core calls](../channel-core-connections/#bind-call-minions-when-core-calls)):
  core calls a new target with `rehello` under the build id, and under the
  session id after; the channel answers under the id it was given and keeps
  nothing between calls; walks and transfers resume through their `ctx`;
  a task ends within the call's deadline.
- **`bind-persistent`** goes as for a listening minion ([opening and closing](../channel-core-connections/#bind-persistent-connections-opening-and-closing)),
  opened by the target's policy, the minion speaking first. It keeps no ids
  of its own, so the `open` says the id it speaks under (`under`, key 10):
  the target's open session's id, else the build's. Its first message is
  its `hello`, alone: under a build id core takes one `hello` or one
  `stage` and nothing else (`protocol.ValidateBuildMessage`), and refuses
  more with an `err`. A hello under the build id opens a session; under
  the session id it says the session's host again. The next message, under
  the session id, carries `get_tasks`, which sets the allowance, and core
  pushes from then on, as on any persistent connection. A minion whose
  hello core refuses closes the connection, saying why: it has nothing to
  do on it. The connection to the server lives as long as the
  socket: when either closes, so does the other.
- **The session's connection** is its target's: the minion knows no build,
  so its `hello` says no `conn`, and core records the target's.
- **No `at` check** ([Freshness and replay](../minion-messages/wire-format/#freshness-and-replay)):
  nothing but core reaches the channel's minion.
- **A target keeps one connection**, as every target does: moving a server
  to the other kind is adding a target on the build's other connection,
  which opens a new session.

## The SSH module

`logos-ssh` is one repo and one image registering two modules, both named
`ssh` as the Dumbo channel and factory are both `dumbo`. Their instance ids
differ: core keys registrations by instance id alone, so a channel and a
factory sharing one would replace each other.

### The factory

Its build schema:

- `crypto`: `aes-256-cbc-hmac-sha256`, as any factory's. Its builds'
  keys stay with core, which gives them to the SSH channel with each call
  and open; the artifact (a description) holds none. No `max_tasks`: a minion that keeps nothing between
  calls could not keep a limit core sets. Through `bind-call` a call
  brings 4 tasks at most; on a persistent connection the minion runs 4 at
  once, each in an SSH channel of its own, and its `hello` says so
  ([Max tasks](../minion-messages/tasks-and-results/#max-tasks)).
- One target, `ssh` ("SSH server"), format `json`, platform `any/any`.
- One channel, `ssh`, with `bind-call` and `bind-persistent`, and no
  connection parameters of the factory's.
- Commands with BOB's ids, params and actions, so core's actions, the file
  browser and the console work with them as they do with BOB's (the `op`
  numbers are the SSH factory's own). All are `default`; none is
  `required`:

  | Command | Action | Result | Over SSH |
  |---|---|---|---|
  | `shell` | | | The command line in `/bin/sh`, in an exec channel (as BOB's runs it on Unix); its output and exit status. A stop kills its process group: what it started too. On a [Windows server](#windows-servers), the line as typed in its default shell, and a stop ends all it started |
  | `ls` | `list_dir` | `dir_listing` | An SFTP directory read (a Windows server's with its attributes, from cmd's `dir`) |
  | `walk` | `walk_dir` | `dir_walk` | SFTP directory reads, resumed through `ctx`; `one_fs` by the server's mount table (`/proc/self/mounts`, else `df`), as SFTP says no file systems; on Windows, by drive |
  | `download` | `download_file` | `file_download` | SFTP reads, a chunk a message |
  | `stream_download` | `stream_file` | `file_stream` | SFTP reads, as the downloader takes them |
  | `upload` | `upload_file` | `file_upload` | SFTP writes |
  | `stream_upload` | `upload_stream` | | SFTP writes, as the bytes come |
  | `rm` | `delete_path` | | SFTP removes, as BOB's `rm` |
  | `volumes` | `list_volumes` | `volumes` | `df -kPT` (GNU's, with types), else `df -kP`; on Windows, the drives |

  No `sleep` and no `exit`. Without a schedule, core calls only when it
  has something to send. A session ends when an operator archives it, and
  removing its target stops the calls.

A build takes seconds. The factory reports it done and uploads a JSON file
saying what the build has (its id, its commands and its connections). There
is nothing to deploy, and nothing secret in it.

### The channel

Its connection schema (`ssh`, version 1), both kinds agentless:

| Kind | `fields`: each build connection's | `target`: each server's |
|---|---|---|
| `bind-call` | `call_reuse` (`30s`: how long the SSH connection stays open after a call for the next one; `0s` logs in for every call) | `host` (required), `port` (`22`), `user` (required), `password`, `private_key` (`format: multiline`; a key whose line breaks a paste lost is made a block again, and a public key or a PuTTY `.ppk` is refused saying so), `passphrase` (secrets), `host_key`, `proxy` (`socks5://`, `socks5h://` or `http://`, CONNECT), `connect_timeout` (`10s`) |
| `bind-persistent` | `keepalive` (`30s`) | The same |

- **Logging in**: with a password or a private key (OpenSSH or PEM, with
  its passphrase), and the key first when a target has both. A target with
  neither gets a failure `login`.
- **The host key**: `host_key` is the server's key's SHA-256 fingerprint
  (`SHA256:…`, as `ssh-keygen -l` prints it). When one is given, the
  server must present that key, or the channel answers a failure
  `host_key` with the key it did present. When none is given, the channel takes the
  key the server presents and reports it in the `hello` (`x.host_key`):
  the session shows it, and an operator pins it by filling it in on the
  target.
- **What came of a call or an open decides the target's state**, as for a
  page:

  | What came of it | The channel answers | Target |
  |---|---|---|
  | DNS failed, refused, timed out | a failure: unreachable or timeout | unreachable, retried |
  | something that is not an SSH server | the first bytes it sent | not the minion |
  | a host key other than the one given | a failure `host_key`, with the key presented | refused |
  | the login refused | a failure `login`, with the methods the server offered | refused |
  | logged in | `hello` | connected |

- **The `hello`** ([Hello](../minion-messages/sessions/#hello)), from one
  exec of `uname -snm; id -un; id -u` and an SFTP read (a Windows server's
  [as below](#windows-servers)):
  - `os` and `arch` from `uname` in Go's names (`Linux` `linux`, `x86_64`
    `amd64`, `aarch64` `arm64`); `host` the node name; `user` the login's;
    `integrity` `root` for uid 0, else `user`;
  - the [machine id](../minion-messages/sessions/#machine-identity):
    `linux-machine-id` from `/etc/machine-id` (else
    `/var/lib/dbus/machine-id`), so a Linux machine BOB reaches too is one
    machine in the file browser; else `ssh-host-key`: the SHA-256 of the
    host key, in hex (core lowercases a machine id, which base64 would not
    survive);
  - `pid` 0: it has no process of its own on the server (a hello's pid is
    optional, 0 for none, for any minion). `version` the module's,
    `max_tasks` 4;
  - `x`: `ssh_server`, the version string the server sent
    (`SSH-2.0-OpenSSH_9.6p1 …`), and `host_key`.
- **Tasks** run each in an SSH channel of its own. Over `bind-call` a
  call's tasks run in it, one after another, as the Dumbo page runs them:
  a task ends within the call's deadline (the shorter of core's, 2
  minutes as the SSH channel declares no `max_call`, and the channel's
  `call_timeout`), a `shell` still running then
  stopped and failed with its output so far ("stopped at the call's
  deadline …: a command meant to run longer needs a bind-persistent
  connection"), and a task after the call's first waits for the next
  call, not acked, once the answer has used half its room or less than 5
  seconds of the call are left. Over `bind-persistent` the
  minion runs up to 4 at once, a task takes as long as it
  takes, and the connection closing stops the tasks on it.
- **Nothing waits on a server for good.** A call lives as long as its
  context: core's deadline, the channel's `call_timeout` (`CALL_TIMEOUT`,
  2 minutes by default, live in its management), and the control link
  (channel-core cancels a
  call's context when the link drops, and opens the link again only once
  its calls returned). Ending the context closes the call's SSH
  connection, so whatever still waits on the server gives up: an SFTP
  request, a command's output. A channel open (a session, the SFTP client)
  waits at most 15 s, and gives up with the connection: `x/crypto/ssh` can
  leave an open unanswered for good on a connection that went away under
  it. A connection that broke this way is not kept for `call_reuse`.

### Windows servers

Windows's OpenSSH (Win32-OpenSSH) is served as BOB's minion runs on
Windows: the same commands, with the paths, results and stops it gives
there.

- **Telling one**: the server's version says so (`OpenSSH_for_Windows`),
  or its SFTP says a drive's folders (`/C:/Users/me`). Paths follow what
  SFTP says; the shell, the hello and the volumes follow the server.
- **Paths** are Windows's (`C:\Users\me`, `\\server\share\x`), which core's
  file browser tells apart whatever their case: `/` read as `\`, a drive
  alone its root (`C:` is `C:\`), `\x` on the login's drive, and the rest
  from the login's folder. Each SFTP call takes its path in SFTP's form
  (`/C:/Users/me`). The drive letter is upper case; the rest is kept as
  typed.
- **Listings**: Windows's SFTP says no owners, modes of its own making, and
  a junction (`Application Data`, `Documents and Settings`) as the folder
  it points to, which it follows. Each listing therefore also asks cmd's
  `dir` of the folder, in UTF-8 (`chcp 65001`), while SFTP lists it. The
  entries' modes are their attributes (read-only, hidden, system, archive,
  reparse point), as BOB sends them and core shows them
  (`-a-h--`). A hidden attribute makes an entry hidden, as a leading dot
  does. A junction is a link to its target, which walks do not enter. A
  folder whose path names a variable (`%TEMP%`, which cmd would expand)
  lists without them.
- **Removing** goes as Go's `os.RemoveAll` on Windows: a junction or a link
  as itself, never what it points to; a read-only file's attribute cleared
  first. A folder whose junctions cmd cannot tell apart is not removed
  through.
- **`shell`**: the line as typed, in the server's default shell. Windows's
  OpenSSH runs `cmd.exe /c "<line>"`, which reads a line as BOB's
  `cmd.exe /d /s /c` does, unless its `DefaultShell` names another. The
  output is as the console's code page writes it. A stop is a `KILL`
  signal, on which Windows's OpenSSH ends the command and all it started;
  closing the channel alone would leave them running, past the connection
  too.
- **The `hello`**, from one PowerShell script (`-EncodedCommand`, within
  what constrained language mode allows, each value said as hex of its
  UTF-16, whatever the console's code page): `os` `windows`; `arch` the
  machine's (`AMD64` `amd64`, `ARM64` `arm64`, `x86` `386`); `host` its
  DNS name; `user` `DOMAIN\user`; `domain` the domain it is joined to (its
  DNS name) or its workgroup; `integrity` from the login's mandatory label
  (`whoami /groups`), as BOB reads its token's: `low`, `medium`, `high`,
  `system`. The machine id is BOB's on Windows: `smbios-uuid`
  (`Win32_ComputerSystemProduct`), else `win-machine-guid` (the registry's
  `MachineGuid`), else `ssh-host-key`. Where PowerShell does not run, cmd
  says what it can: the host, the architecture, `whoami`, the
  `MachineGuid`, the label.
- **`volumes`** are the drives (`Win32_LogicalDisk`): each one's kind by
  its drive type, label, file system, size and free space, a network
  drive's share, and an empty drive (a DVD drive with nothing in it) with no
  media. Where PowerShell does not run, they are the drives SFTP's root
  lists, with the space `statvfs@openssh.com` says.

## Trust

An agentless channel is not blind:

- it holds the keys of the builds it serves, which core gives it with
  every `call` and `open`, and so reads what it carries: commands, their
  output, files;
- it holds the targets' credentials, which core gives it with every `call`
  and `open`, as it gives any `bind` channel its target's
  [secrets](../channel-core-connections/#the-connection-schema-by-kind).

Run one where you would run an agent. Its link to core carries those keys
and credentials, so it needs TLS (core behind nginx) and
channel authentication: mTLS or a shared secret, planned, not built
([HTTP Sync](../channel-core-sync/)). Until channel authentication is
built, run an agentless channel only where its link to core is private:
core's Docker network, or a VPN.

## The work

In order:

1. This page.
2. **Protocol**: `agentless` on `bind` kinds, `keys` and `under` on calls
   and opens, the link failure kinds and the machine id source.
3. **`logos-ssh`** (a new repo): the factory, the channel, and the
   channel's own minion: for calls as the Dumbo page answers them (a
   call's tasks run in it, walks and transfers going on from their ctx),
   for a persistent connection as a listening minion runs (tasks in the
   background, pushed as they come), acting on the server over SSH and
   SFTP (`golang.org/x/crypto/ssh`, `github.com/pkg/sftp`).
4. **Core**: the suite, agentless kinds, an open's `under`,
   the session's connection from its target, the UI.
5. **Docs**: the pages this changes (Wire Format, Sessions, Minion Build,
   Minion Connection Schema, Connections, Module Types, Architecture), and
   this page's draft notice dropped.

## Open questions

- **Channel authentication**: mTLS or a shared secret, needed before an
  agentless channel runs outside core's own network.
- **A schedule** for SSH targets: periodic logins that show a server is
  still there.
- **Later**: jump hosts (a target reached through another), tunnels through
  a session, an interactive shell (a PTY) in the console over a persistent
  connection.

## Design notes

- **Why the channel acts as the minion.** Something on our side has to,
  since an SSH server speaks no Logos. A second task path (tasks sent to
  the channel in the clear) would repeat tasks, results, transfers, streams
  and cancels outside the minion protocol, and the two would drift apart.
  Core speaking SSH itself would put every agentless protocol (SSH, later
  WinRM or SMB) in core, send every SSH round trip across the link between
  core and the channel, and drop every SSH session when core restarts. In
  the channel, the minion protocol stays the only one, and core changes
  little.
- **Why keys, not a suite of no crypto.** A `none` suite was built first,
  and dropped: it made the SSH factory a special case everywhere in core
  (unsealed messages, no keys, no staging, its own marks in the UI), while
  a page and an SSH server are reached the same way. With keys, core seals
  every message alike, and `agentless` means one thing: the channel gets
  the keys. The keys travel with the messages they seal over the link, so
  they hide nothing from whoever reads that link; what they keep is that
  only core and the channel can speak under a build's or a session's id,
  which a suite of no crypto gave to anyone who knew the id.
- **Why still a factory.** A build is a factory's from start to finish:
  offered to one of its instances, made of its schema's commands and flags,
  finished by its artifact, built again from its form. A build that core
  made for a channel would be a second kind of build in every one of those
  places. A factory that builds in seconds keeps one kind, and brings
  command sets per build (a read-only build without `rm`, `upload` or
  `shell`), versions and Build again with it.
- **Why the SSH minion is its own.** Minions share the protocol and its
  contracts (`logos-golang-protocol`), not their workings: BOB's minion,
  the Dumbo page and the SSH channel's minion each run their tasks their
  own way, and none waits on another's changes. The SSH minion takes its
  ways from BOB's (a persistent connection) and the Dumbo page's (calls),
  and keeps them in `logos-ssh`.
- **Why a refused login is a failure, not an `err`.** An `open` carries no
  id for a message to answer under, and a refusal reads the same whether a
  call or an open met it: the channel answers either with a failure of its
  own kind, and core shows the target refused without retrying it.
- **Why a target keeps one connection.** Switching a server between kinds
  would need targets that move between connections and a switch that core
  runs on the minion's behalf. Adding a target on the other connection is
  enough.
- **Why ask cmd of a Windows listing.** SFTP says a junction as the folder
  it points to, and follows it: a walk would loop through one that points
  above it (`AppData\Local\Application Data` is `AppData\Local`), and a
  removal would reach through one into what it points to. Only Windows
  itself says which entries are junctions, with the attributes beside
  them. `dir` says both in one exec, beside the SFTP read: a few tens of
  milliseconds a folder. PowerShell would say them too, but it takes ten
  times that to start.
- **Why the host key as a machine id.** An SSH server's host key is what
  identifies it before any login, and reading it runs nothing. The machine
  id file comes first, so that a machine reached both by a minion and over
  SSH is one machine in the file browser.
