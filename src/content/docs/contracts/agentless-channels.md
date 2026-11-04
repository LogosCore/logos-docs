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
    C->>CH: call {target's values, rehello}, unsealed
    CH->>S: SSH login (a password or a key)
    CH->>S: uname, id; /etc/machine-id over SFTP
    CH->>C: answer {hello}
    C->>CH: call {task: ls /etc}, under the session id
    CH->>S: SFTP: read the directory
    CH->>C: answer {result: dir_listing}
```

| Part | What changes |
|---|---|
| Protocol | The `none` crypto suite; `agentless` on a `bind` kind of a connection schema; the link failure kinds `login` (5) and `host_key` (6); the machine id source `ssh-host-key` (11) |
| Core | `none` builds (no keys, no sealing, no staging), taken only where their channel is the minion; core speaks first on an agentless kind's connection socket; the session's connection taken from its target; the failures `login` and `host_key` shown as refused, not retried, for calls and opens; "unencrypted" on such builds and sessions |
| SSH module | `logos-ssh`, new: the `ssh` factory, and the `ssh` channel with its own minion (for calls as the Dumbo page answers, for a persistent connection as a listening minion) |
| Unchanged | Targets and their states, sessions, tasks, results, file transfers, streams, the file browser, the console |

## The `none` suite

- **A factory declares it**: `"crypto": "none"` in its [build
  schema](../minion-build/#the-build-schema). Its minions and core exchange
  messages unsealed.
- **Explicitly, never by leaving `crypto` out.** A schema without a suite
  registers and builds today, but core opens none of its minions' messages,
  and that stays so: an empty suite is a forgotten one, not a choice.
- **No keys.** Core generates none; a build request's `crypto` names only
  the suite (`{"suite": "none"}`), and the artifact holds nothing secret.
- **Frames keep their shape.** Where a sealed message goes (the `call`'s
  key 4, the `answer`'s key 4, a connection socket frame's key 2: [formats](../channel-core-connections/#the-control-link-and-connection-sockets-formats)),
  the message's CBOR goes as it is, under its id as before.
- **No staging.** Under a `none` build's id core takes only `hello`; a
  `stage` gets `bad_message` ([Staging](../minion-messages/sessions/#staging)).
  The session has no keys.
- **Only where the channel is the minion.**
  - A build of a `none` factory may have only connections of
    [agentless kinds](#agentless-kinds); core refuses any other
    (`validation_failed`). No unsealed message crosses a transport that
    anyone but the channel reaches.
  - Core takes an unsealed message under a `none` build's or session's id
    only in an `answer` to its own `call`, and on a connection socket that
    an `open` for one of that build's targets brought. A sync call under
    one gets 422, as a frame core cannot open.
  - Core never sends one to a kind that is not agentless, or no longer is:
    a target of such a kind shows **needs editing** and is not called.
- **The UI says so**: "unencrypted" on such builds and their sessions, and
  on the factory's page.

The seal does two things: it hides a message, and its HMAC shows that the
minion sent it, since ids travel in the clear. Between core and an
agentless channel there is nothing to hide from the channel, which acts on
the plaintext anyway. And the channel *is* the minion, so what shows that a
message came from it is the link it came over. Keys sent to it with the
message would protect nothing that the link does not.

## Agentless kinds

A channel says it per kind, in its [connection schema](../minion-connection/#the-schema):

```json
"bind-call": { "agentless": true, "fields": [ "call_reuse" ], "target": [ "host", "port", "user", "…" ] }
```

- **`agentless`**: optional, `false` by default, for `bind-call` and
  `bind-persistent` only (core refuses it on a `reverse` kind). It means
  the channel answers for the minion: no minion runs on the target, and the
  channel reads and writes the messages of that kind.
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
  opened by the target's policy, except that **core speaks first** on the
  new socket, because the minion keeps nothing from one connection to the
  next: `rehello` under the build id when the target has no session yet,
  otherwise a message under the session id. The minion answers a `rehello`
  with its `hello` alone: under a build id core takes one `hello` or one
  `stage` and nothing else (`protocol.ValidateBuildMessage`), and refuses
  more with an `err`. Its next message, under the session id the
  `hello_response` gives, carries `get_tasks`, which sets the allowance, and
  core pushes from then on, as on any persistent connection. A minion whose
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

- `crypto`: `none`. No `max_tasks`: a minion that keeps nothing between
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
  | `shell` | | | The command line in `/bin/sh`, in an exec channel (as BOB's runs it on Unix); its output and exit status. A stop kills its process group: what it started too |
  | `ls` | `list_dir` | `dir_listing` | An SFTP directory read |
  | `walk` | `walk_dir` | `dir_walk` | SFTP directory reads, resumed through `ctx`; `one_fs` by the server's mount table (`/proc/self/mounts`, else `df`), as SFTP says no file systems |
  | `download` | `download_file` | `file_download` | SFTP reads, a chunk a message |
  | `stream_download` | `stream_file` | `file_stream` | SFTP reads, as the downloader takes them |
  | `upload` | `upload_file` | `file_upload` | SFTP writes |
  | `stream_upload` | `upload_stream` | | SFTP writes, as the bytes come |
  | `rm` | `delete_path` | | SFTP removes, as BOB's `rm` |
  | `volumes` | `list_volumes` | `volumes` | `df -kPT` (GNU's, with types), else `df -kP` |

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
  exec of `uname -snm; id -un; id -u` and an SFTP read:
  - `os` and `arch` from `uname` in Go's names (`Linux` `linux`, `x86_64`
    `amd64`, `aarch64` `arm64`); `host` the node name; `user` the login's;
    `integrity` `root` for uid 0, else `user`;
  - the [machine id](../minion-messages/sessions/#machine-identity):
    `linux-machine-id` from `/etc/machine-id` (else
    `/var/lib/dbus/machine-id`), so a Linux machine BOB reaches too is one
    machine in the file browser; else `ssh-host-key`: the SHA-256 of the
    host key, in hex (core lowercases a machine id, which base64 would not
    survive);
  - `pid` 0: it has no process of its own on the server. A hello needs a
    pid, except in an unsealed message: core checks that one with the
    protocol's `HelloItem.ValidateAgentless`, which takes 0. `version` the
    module's, `max_tasks` 4;
  - `x`: `ssh_server`, the version string the server sent
    (`SSH-2.0-OpenSSH_9.6p1 …`), and `host_key`.
- **Tasks** run each in an SSH channel of its own. Over `bind-call` a
  call's tasks run in it, one after another, as the Dumbo page runs them:
  a task ends within the call's
  deadline (the channel's request timeout), a `shell` still running then
  stopped and failed with its output so far ("a long command needs a
  persistent connection"), and a task waits for the next call, not acked,
  once the answer has used half its room. Over `bind-persistent` the
  minion runs up to 4 at once, a task takes as long as it
  takes, and the connection closing stops the tasks on it.
- **Nothing waits on a server for good.** A call lives as long as its
  context: core's deadline, and the control link (channel-core cancels a
  call's context when the link drops, and opens the link again only once
  its calls returned). Ending the context closes the call's SSH
  connection, so whatever still waits on the server gives up: an SFTP
  request, a command's output. A channel open (a session, the SFTP client)
  waits at most 15 s, and gives up with the connection: `x/crypto/ssh` can
  leave an open unanswered for good on a connection that went away under
  it. A connection that broke this way is not kept for `call_reuse`.

## Trust

An agentless channel is not blind:

- it sees what it carries in the clear: commands, their output, files;
- it holds the targets' credentials, which core gives it with every `call`
  and `open`, as it gives any `bind` channel its target's
  [secrets](../channel-core-connections/#the-connection-schema-by-kind).

Run one where you would run an agent. Its link to core carries that
plaintext and those credentials, so it needs TLS (core behind nginx) and
channel authentication: mTLS or a shared secret, planned, not built
([HTTP Sync](../channel-core-sync/)). Until channel authentication is
built, run an agentless channel only where its link to core is private:
core's Docker network, or a VPN.

## The work

In order:

1. This page.
2. **Protocol**: the `none` suite, `agentless` on `bind` kinds, the link
   failure kinds and the machine id source.
3. **`logos-ssh`** (a new repo): the factory, the channel, and the
   channel's own minion: for calls as the Dumbo page answers them (a
   call's tasks run in it, walks and transfers going on from their ctx),
   for a persistent connection as a listening minion runs (tasks in the
   background, pushed as they come), acting on the server over SSH and
   SFTP (`golang.org/x/crypto/ssh`, `github.com/pkg/sftp`).
4. **Core**: the suite, agentless kinds, speaking first on their sockets,
   the session's connection from its target, the UI.
5. **Docs**: the pages this changes (Wire Format, Sessions, Minion Build,
   Minion Connection Schema, Connections, Module Types, Architecture), and
   this page's draft notice dropped.

## Open questions

- **Channel authentication**: mTLS or a shared secret, needed before an
  agentless channel runs outside core's own network.
- **Windows OpenSSH servers**: telling one (its `uname` fails, and SFTP
  paths start with a drive, `/C:/`), its shell (cmd or PowerShell), its
  paths, volumes and integrity.
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
- **Why `none` and not keys.** Keys sent to the channel with each `call`
  and `open` would travel with the messages they seal: they would protect
  nothing that the link does not. `none` says what is true, and its rules
  keep unsealed messages on the one link where that holds.
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
- **Why the host key as a machine id.** An SSH server's host key is what
  identifies it before any login, and reading it runs nothing. The machine
  id file comes first, so that a machine reached both by a minion and over
  SSH is one machine in the file browser.
