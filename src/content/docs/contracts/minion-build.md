---
title: "Minion Build"
---

:::note[Payload crypto]
Everything on this page is built (the protocol types, factory-core, core, the
web app, and BOB as the reference factory). Of payload crypto, core generates a
minion's keys for its factory's suite and sends them in the build; encrypting
and decrypting minion traffic waits for the payload crypto contract.
:::

Factories build minions. What a factory can produce, and what each build needs,
depends on the factory: one builds Windows services and Linux binaries, another
only scripts. So **each factory declares it**, as a **build schema** sent at
[registration](../module-lifecycle/#moduleregister), the same way a channel
declares its [connection schema](../minion-connection/). The app builds its
forms from the schema. Core validates what operators enter, adds the minion's
identity, connection settings and payload crypto keys, and asks
the factory to build.

```mermaid
flowchart LR
    F[Factory instance] -- "module.register: build schema" --> CORE[Core]
    OP[Operator] -- "target, commands, values, files, connections" --> CORE
    CORE -- "factory.build: + build id, connections" --> F
    F -- "progress, result" --> CORE
    F -- "artifact upload" --> S3[(SeaweedFS)]
```

Builds are **asynchronous**: the factory accepts a build at once, reports
progress while it works, and sends the result when it is done. A build can take
minutes, longer than a management action is allowed to run.

## The build schema

Declared in `module.register` under `build`:

```json
{
  "schema_version": "3",
  "version": 1,
  "channels": [
    {
      "module_name": "http", "num": 1, "versions": [3],
      "kinds": [
        {
          "kind": "reverse-call",
          "fields": [
            {
              "key": "method", "num": 1, "type": "enum", "label": "Method", "default": "POST",
              "options": [{ "value": "GET" }, { "value": "POST" }, { "value": "PUT" }]
            },
            {
              "key": "path_prefix", "num": 2, "type": "string", "label": "Path prefix", "default": "/",
              "description": "Every request path starts with it, e.g. /cdn/assets/ when the front forwards only that path.",
              "pattern": "^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$", "max_length": 256
            }
          ]
        },
        {
          "kind": "reverse-persistent",
          "fields": [
            {
              "key": "path_prefix", "num": 2, "type": "string", "label": "Path prefix", "default": "/",
              "description": "The WebSocket's path starts with it.",
              "pattern": "^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$", "max_length": 256
            }
          ]
        }
      ]
    },
    { "module_name": "dns", "num": 2, "versions": [1], "kinds": [{ "kind": "reverse-call" }] }
  ],
  "crypto": "aes-256-cbc-hmac-sha256",
  "fields": [
    { "key": "kill_date", "num": 1, "type": "datetime", "label": "Kill date", "group": "Limits", "order": 1 },
    {
      "key": "guardrails", "num": 2, "type": "enum_list", "label": "Run only if", "group": "Limits", "order": 2,
      "options": [
        { "value": "domain_joined", "label": "Domain-joined" },
        { "value": "no_debugger", "label": "No debugger attached" }
      ]
    },
    { "key": "debug", "num": 3, "type": "bool", "label": "Debug build", "default": false, "group": "Build", "order": 3 }
  ],
  "targets": [
    {
      "id": "windows-exe", "label": "Windows executable", "format": "exe",
      "platforms": ["windows/amd64", "windows/386", "windows/arm64"],
      "fields": [
        { "key": "icon", "num": 4, "type": "file", "label": "Icon", "accept": [".ico"], "max_size": 262144, "group": "Appearance", "order": 4 }
      ]
    },
    {
      "id": "windows-service", "label": "Windows service", "format": "exe",
      "platforms": ["windows/amd64"],
      "fields": [
        {
          "key": "service_name", "num": 5, "type": "string", "label": "Service name", "required": true,
          "pattern": "^[A-Za-z0-9_-]{1,64}$", "group": "Service", "order": 4
        }
      ]
    },
    { "id": "linux-elf", "label": "Linux binary", "format": "elf", "platforms": ["linux/amd64", "linux/arm64"] },
    {
      "id": "shellcode", "label": "Shellcode", "format": "bin",
      "platforms": ["windows/amd64", "linux/amd64"],
      "channels": [{ "module_name": "http", "versions": [3], "kinds": ["reverse-call"] }]
    }
  ],
  "commands": [
    {
      "id": "sleep", "op": 1, "label": "Sleep", "required": true,
      "description": "Changes how long the minion waits between check-ins.",
      "params": [
        { "key": "interval", "num": 1, "type": "duration", "label": "Interval", "required": true },
        { "key": "jitter", "num": 2, "type": "int", "label": "Jitter", "unit": "%", "min": 0, "max": 100, "default": 0 }
      ]
    },
    { "id": "exit", "op": 2, "label": "Exit", "required": true },
    {
      "id": "shell", "op": 3, "label": "Run a command", "default": true,
      "params": [{ "key": "command", "num": 1, "type": "string", "label": "Command", "required": true }]
    },
    {
      "id": "download", "op": 4, "label": "Download a file", "default": true,
      "params": [{ "key": "path", "num": 1, "type": "string", "label": "Path", "required": true }]
    },
    { "id": "screenshot", "op": 5, "label": "Screenshot", "targets": ["windows-exe"] }
  ],
  "error_codes": [
    { "code": 3, "label": "Its config does not read", "description": "The settings built into the minion are damaged: build it again." },
    { "code": 4, "label": "Past its kill date" }
  ]
}
```

| Field | Meaning |
|---|---|
| `schema_version` | Format of this structure: `"3"` (connection kinds, each with its own parameters, per channel; commands and their params numbered). `"1"` and `"2"` are no longer taken. |
| `version` | Version of the factory's parameter set, from 1. Raised when values saved against the previous set would build something else or fail: a field or target removed, renamed or given another meaning. Adding an optional field or a target does not need it. |
| `channels[]` | At least one: the channel kinds the minions can speak: `module_name`, the connection schema `versions` they read (1 to 16), and `kinds`; and `num`, the channel's number in a [minion config](#the-minion-config), 1 to 65535, once in the schema. |
| `channels[].kinds[]` | At least one, in the factory's order of preference: the [connection kinds](../channel-core-connections/#kinds-in-the-build-schema-and-in-builds) the minions support through that channel, each `kind` with optional `fields`, the factory's own [connection parameters](#connection-parameters) for a connection of that kind, in full. |
| `crypto` | Optional. The payload crypto suite the minions implement. Core's, whose keys core generates for each minion: only `aes-256-cbc-hmac-sha256` (AES-256-CBC, then HMAC-SHA256 over the ciphertext) for now, and core refuses a registration with another suite without a dot (`validation_failed`). Or the factory's own, `<module_name>.<name>`, which the factory translates and makes the keys of ([Codecs](../minion-messages/codecs/)). |
| `envelope` | Optional. How the minions write a message as plaintext: `cbor` (the default) or `json`, core's, or the factory's own, `<module_name>.<name>`, which it translates ([Codecs](../minion-messages/codecs/)). |
| `codec` | Required when the schema or a target names a suite or an envelope of the factory's own, refused otherwise: `growth` (percent, 100 to 400), `overhead` (bytes, 0 to 4096) and `timeout` (a duration, 100 ms to 30 s; 5 s by default), what the factory's [translation](../minion-messages/codecs/#a-builds-codec) may take. |
| `fields[]` | Build parameters shared by every target. Field specs as in a [management manifest](../module-management/#fields), plus the [types below](#field-types-for-builds). |
| `targets[]` | What the factory can produce, at least one. |
| `commands[]` | Optional. What the minions can do. Operators pick each build's [commands](#commands) from its target's. |
| `error_codes[]` | Optional. What the minions' exit codes mean: the factory's own [minion error codes](#minion-error-codes), for operators to look up. |
| `failover` | Optional, `false` by default. The minions honor a build's [failover settings](../channel-core-connections/#failover): they move between their connections on their own as those say. Without it the settings still reach the factory, which may ignore them; the build form says so. |
| `max_tasks` | Optional, `false` by default. The minions' limit of tasks at once is the operators' to set: a build says how many (`max_tasks` in the request, under Commands in the build form), their `hello` says it, and core changes it live ([Max tasks](../minion-messages/tasks-and-results/#max-tasks)). Without it a build has no limit to set, and a minion runs as many as its factory made it (one at a time, say), which its `hello` may report but nothing changes. |
| `compression` | Optional. The algorithms the minions inflate: `["deflate"]`, the one the protocol has. A build packs its messages with it unless the operator turns that off (`compression` in the request, Compress messages in the build form): core packs the items it sends the minion where that pays, and the minion may pack its own ([Compression](../minion-messages/wire-format/#compression)). Without it core packs nothing for its minions. Protocol v0.47.0; BOB declares it. |
| `persisted_sessions` | Optional, `false` by default. The minions can claim a persisted session: built with a `session_id`, they claim it in their `hello` (see [Persisted sessions](../minion-messages/sessions/#persisted-sessions)). Operators can build such a minion from a session only for a factory that says so. |
| `minion_config` | Optional, `false` by default. The factory wants each build's settings numbered, as a minion reads them: core sends a [minion config](#the-minion-config) with each build request (`minion_config`), numbered CBOR for the factory to use as it decides. Every schema numbers its channels, fields and connection parameters, so core can make one for any build. BOB declares it, and bakes the config in whole. |

A target:

| Field | Meaning |
|---|---|
| `id` | Identifier, unique in the schema, `^[a-z][a-z0-9_-]{0,62}$`. |
| `label`, `description` | Shown in the UI. |
| `format` | What the artifact is: `exe`, `dll`, `elf`, `so`, `macho`, `dylib`, `bin` (raw shellcode), `script`, `zip`, or another name of the same form. Shown and filtered on; the factory names the file. |
| `platforms[]` | Where the artifact runs, as `os/arch` with Go's names (`windows/amd64`, `linux/arm64`, `darwin/arm64`). `any` stands for either half: `any/any` for a script. Checked by form only, so a new platform needs no protocol release. |
| `fields[]` | Parameters of this target only, added to the shared ones. |
| `channels[]` | Optional. Narrows the factory's `channels` for this target, to channel kinds, `versions` and connection `kinds` (names only) the factory lists. The connection parameters stay the factory's. |
| `opens[]` | Optional. Narrows what this target's tunnel commands open (their `opens[]`), for a platform that has less: a Linux build has no named pipes. Empty: all of them. |
| `crypto`, `envelope` | Optional. Replace the schema's for this target's builds ([Codecs](../minion-messages/codecs/)): one factory may build a minion in a compiled language and one in a script. A target whose codec is not core's CBOR with core's suite connects through no [agentless](../agentless-channels/) kind: core refuses such a build. |

- Core validates the schema at registration (structure, limits, defaults
  against their own specs) and refuses a registration whose schema is invalid
  (`validation_failed`). Only factories may declare `build`; a registration
  without it clears the stored one. factory-core runs the same check before it
  starts, and does not start with an invalid schema.
- Field keys are unique across the shared fields and each target's own fields.
- Every build field (a `file` one too) and every connection parameter has a
  `num`, its key in a [minion config](#the-minion-config), 1 to 65535, and
  every `channels` entry its own, unique in the schema: core refuses a schema
  missing one, whether the factory's minions read numbers yet or not. A
  number names one key across the shared fields and every target's own, and
  across a channel's kinds' parameters, and a key numbered in two places has
  the same number in both. Like a command's `op`, a number once given stays
  its field's.
- Target and command ids are unique; a target's `format` takes the same form
  as an id. Platforms are `os/arch` in lowercase letters and digits, each half
  up to 31 characters, unique in their target.
- Channel kinds are unique, each with its `versions` unique and from 1. A
  target's `channels` name only kinds and versions the factory lists.
- Suites and envelopes are slugs (`^[a-z0-9][a-z0-9._-]{0,62}$`): one without a
  dot core implements, one with a dot the factory's own, its `module_name`
  first (another module's is refused).
- A command's `targets` name only targets of the schema, once each.
- Labels are up to 120 characters and descriptions up to 1,000, as in a
  management manifest.
- Like the connection schema, the build schema belongs to the **factory kind**
  (`module_name`). Core uses the kind's **latest** schema: the highest
  `version` any instance declared, from its most recent registration.

Limits: 32 targets, 64 fields per target (shared ones included), 1 to 16
platforms per target, 1 to 16 channel kinds with 1 to 16 versions each, 32
connection parameters per channel kind, 256 commands, 32
params per command.

### Connection parameters

A channel's [connection schema](../minion-connection/) says how to **reach**
the channel. It says nothing about how a minion family **uses** it: the HTTP
channel accepts any method and any path, so which method a minion sends, and
under which path, is the minion's choice. An operator may need to set that per
connection, for example when a CDN forwards only `/cdn/assets/*` to the channel.

A factory declares such parameters as the `fields` of a connection kind of a
`channels` entry: each kind its own, in full (a WebSocket has one handshake,
so BOB's `reverse-persistent` has no `method`). They are field specs like any
other, set **per connection**: the build holds one set of values for each
[connection](#connections) the minion is given, by its kind.
In the build request, each connection's settings come as an endpoint export,
next to these values with defaults filled in (see [`factory.build`](#factorybuild)).

A parameter may reuse a key of the channel's schema: the two never mix, since
the minion reads each from its own place. In a [minion config](#the-minion-config)
a parameter goes by its `num`, the channel's settings by the channel's own.

### Field types for builds

Three field types are added. `datetime` and `enum_list` join the shared types,
so management properties and connection schemas can use them too; `file` is
accepted only in build schemas: in a build's fields, and in a command's
`params` (a file to send the minion with the task).

| Type | JSON value | Rules |
|---|---|---|
| `datetime` | string, RFC 3339, e.g. `"2027-01-31T00:00:00Z"` | `min`, `max` as RFC 3339 strings |
| `enum_list` | array of option values | each one of `options[].value`, no repeats; `max_items`; `required` means at least one |
| `file` | string: a [build file](#build-files) id | `accept`: up to 32 extensions (`.ico`) or media types (`image/x-icon`, or `image/*` for any subtype), any file when empty; `max_size`: the largest file, in bytes. No `default`. |

`credential` and `credential_list` (the operation's credentials, of the types
`accept` names) are taken in build schemas too: in a build's fields, its
connection parameters and a command's params. The factory gets them in the
request's `credentials`; a command's minion, in the task's arg. See
[Credentials](../credentials/).

`accept` and `max_size` are new field spec members, for `file` only. In the
UI, `datetime` is a date and time picker, `enum_list` a set of checkboxes, and
`file` an upload or a choice from the operation's build files.

In a command's `params`, a `file` value is not a build file: it is a file the
operator uploads to core for the task (a [task
file](../task-results-and-actions/#task-files)), and the minion gets it in a [transfer from
core](../minion-messages/file-transfers/#core-sending-a-file). `max_size` may not be over
core's limit for those (`MINION_FILE_MAX_SIZE`, 2 GiB by default); without
one, that limit applies. In the command form, the param is a file picker:
the file goes to core as soon as it is picked, with its progress, and Run
queues the task with its id. A command line for a command with a file
param, typed without it, opens the form.

A command's `params` may instead take a `stream`: the file's name, a
`string`. The minion gets the file [streamed from
core](../minion-messages/file-transfers/#streaming-a-file-to-a-minion) as its uploader
sends it, of any size, nothing kept (see
[`upload_stream`](../task-results-and-actions/#upload_stream)). A command
takes one `file` or `stream` param at most, with no default. A stream may be
optional: given no name (a file uploaded with curl, which says none), core
names it by the last part of the task's `path` arg, and refuses a task whose
path names no file. In the command form it is a file picker: a file picked
there goes from the browser once the task is queued; none picked, it goes
with curl from the task's view.

### Commands

A minion can do only what was built into it. The factory declares what its
minions **can** do as `commands`, and the operator picks what **this** minion
does when they build it: a minion built for one job carries nothing more.

| Field | Meaning |
|---|---|
| `id` | Identifier, unique in the schema, `^[a-z][a-z0-9_-]{0,62}$`, and not `help`, `connect`, `disconnect` or `max_tasks`. Builds, core and operators name the command by it. |
| `op` | The command's number, unique in the schema, 1 to 65 535: what a [task](../minion-messages/tasks-and-results/#tasks) names it by on the wire. |
| `label`, `description` | Shown in the UI. |
| `targets[]` | Optional. Narrows the command to these targets; empty means every target. |
| `default` | Picked in a new build until the operator unpicks it, and what a build that names no commands gets. |
| `required` | In every build of its targets: the minion cannot run without it (`sleep`, `exit`), so the operator cannot leave it out. |
| `params[]` | What a task of the command takes: field specs as in a management action, and `file` (a [task file](../task-results-and-actions/#task-files), sent to the minion with the task): one at most, with no default. Each has a `num`, unique in the command, 1 to 65 535: what a task names the arg by on the wire; only a command's params have one. A param core adds to every command of its [action](../task-results-and-actions/) (a tunnel's `front`, `port`, `host`, `to`, `stop_idle`, `cap`) a factory does not declare: it has no `num`, and never goes to the minion. A param may apply only by another's value ([`when`](../module-management/#fields), one of core's included: BOB's tunnel `timeout` with any front but `terminal`) and be `advanced` (under the form's More options). |
| `result` | Optional. What its task's `data` is: one of core's [results](../task-results-and-actions/) (`dir_listing`), its shape and view. Without one, the `data` shows as raw JSON. A name core does not know refuses the schema. |
| `action` | Optional. What core can ask the command to do itself: one of core's [actions](../task-results-and-actions/) (`list_dir`). The command takes the action's params, gives every other param a default, and has the result the action needs. A name core does not know refuses the schema. |
| `opens[]` | Optional, a [tunnel](../minion-messages/tunnels/#the-tunnel-commands) command's alone: what its minion opens, and how, each once: `tcp`, `udp` (UDP associations, a UDP listener); a `tunnel`'s `unix`, `pipe` (a forward to a path), `source` (from an address of its host), `tls` (TLS to the destination), `process` (a terminal's process) and `accept` (SOCKS5 `BIND`); none said, `tcp` alone. A target narrows it (its `opens[]`). Core opens nothing else through it, and offers only the params it opens. |
| `serves[]` | A [delegate](../minion-messages/delegation/#the-delegates-tasks) command's alone, required there (action `delegate` or `reverse_delegate`): the channel kinds its minions serve for other minions, each `{module_name, versions, kinds}` as `channels` names them, 16 at most, each channel kind once. `delegate` serves bind kinds, `reverse_delegate` reverse ones; never an agentless kind. Such a command names its own `kinds`, never `bind-call`. A factory that serves other kinds on another target declares another command (`targets`). |
| `kinds[]` | Optional. The [connection kinds](../../module-types/#connection-kinds) the command works over, each one the factory's minions use with some channel; empty means every kind. For a command that does not work, or not well, over the others (an interactive shell needs both sides speaking at once): core refuses its task on a session whose minion uses another kind, saying which. The build form's command list, the factory's page and `help` say where it works; the console's command line marks one the session's minion cannot take where it is ("switch first"). |

- A build's commands are the ones picked, the target's required ones among
  them, in the schema's order. Among commands with one
  [action](../task-results-and-actions/#running-an-action), that order is
  the factory's preference: core runs the first when it starts one itself
  and the operator picked none. A build that leaves `commands` out (or sends
  `null`) gets the target's `default` and `required` ones; one that sends an
  empty list gets the required ones only.
- The factory builds those in and no others: what the minion can do is its
  build's `commands`. A factory that cannot build one in fails the build.
- `help` is core's own command, in every session's console: it lists the
  session's commands with how each is typed, or (`help <command>`) one
  command's params. Core answers it when it is queued and keeps it as a
  finished task; it never goes to a minion. `connect` and `disconnect` are
  core's too, in the console of a session whose connection is
  `bind-persistent`: they open and close its target's connection
  ([Connections](../channel-core-connections/#bind-persistent-connections-opening-and-closing)),
  kept as tasks. `max_tasks` is core's too, in the console of a session
  whose build's factory declares `max_tasks` and whose minion said its
  limit: `max_tasks <max>` sets how many tasks the minion runs at once, as
  the session's Tasks do ([Max tasks](../minion-messages/tasks-and-results/#max-tasks)).
  A schema that declares any of the four is refused
  (`protocol.IsCoreCommand`), and factories do not implement them.
- A console line that starts with `/` is **the console's own**, run in the
  browser for the operator typing it: never a task, so no minion and no
  session's history sees it. A command's `id` starts with a letter, so no
  build's command can be one. `/fx [lightning|inferno|off]` sets the
  prompt's effect, kept with the operator's sessions layout (`promptFx`) for
  every session; none shows when the system asks for less motion. Text
  pasted or cut, more than a letter at once, plays along the text it moved,
  as if its letters were typed or deleted at once. Lightning: a charge that
  builds as keys come fast (as inferno's heat) and runs down in a couple of
  seconds, crackling across the line's text while it is up (short arcs over
  its letters, sparks popping off them, more and longer the higher it is),
  not piled on the key; a bolt at the caret as a key is typed, a little
  taller and forked as the charge builds; arcs in a set (two to five, each
  wandering, creased and bright its own way) across a word as it is
  completed (Tab) and sweeping along a line recalled from the history (↑
  back, ↓ on; past the oldest, a fizzle that halves the charge), and the
  same sweep along text pasted (its sparks flying up) or cut (falling); a
  strike of two to four bolts from the top of the console as a line runs,
  its flash soft and never three a second. Inferno: fire as the On Fire mark
  burns it (the Doom fire, in its colors, painted crisp) along the bottom of
  the console, but quick, as light stuff burns: small puffs that flash up
  and are gone in a fifth of a second, heat coming into it where things
  happen: a puff at the caret as a key is typed, taller as the heat builds
  (keys coming fast, cooling in a couple of seconds), a low bed of fire
  along the bottom while it is hot; a fuse burning along a completed word or
  a recalled line; smoke and ash for a key deleted; flames off the letters
  of text pasted, heating as typing does; flame, smoke and ash where text
  cut was; a line that runs flashes all at once, its letters glowing hot and
  burning out in a white-hot puff off the whole line; steam for one that
  does not read, which halves the fire and the heat.
- **A task names its command by `op` and its args by their params' `num`**
  ([Tasks](../minion-messages/tasks-and-results/#tasks)), so a minion needs
  no command or param names: it dispatches on numbers the factory compiled
  in. Operators, core and the API keep using `id` and `key`; core puts the
  numbers in when it sends the task.
- An `op` or `num`, once given, belongs to that command or param: minions
  already built read it. Never move one or give it to another; a command or
  param that goes leaves its number unused.
- A command removed or renamed needs a new `version`, like a field. Adding
  one does not, a required one included: core adds it to every build of its
  targets.

### Minion error codes

A minion that stops on an error (a config it cannot read, no connection it
can use) has nobody to tell but its exit code. `error_codes` (optional) says
what the factory's minions mean by theirs, so an operator who sees a minion
exit with 3 looks up what 3 is. Each one:

| Field | Meaning |
|---|---|
| `code` | 1 to 255, once in the schema: an exit code every OS keeps whole (a Unix process's is a byte). 0 is success and never one. |
| `label` | Required: what it means, in a few words (120 characters at most). |
| `description` | Optional: more, such as when it happens and what to do (1000 characters at most). |

A factory may declare a runtime's own codes too, to say what they mean for
its minions: Go exits with 2 on a panic, and shells report a process a
signal killed as 128 and the signal's number (137 for `SIGKILL`). Codes of
its own between 3 and 125 keep clear of those. A code, once given, keeps its
meaning: minions already built exit with it.

Core keeps the codes with the factory's schema and shows them, as the
Minion error codes card on the factory's page under Modules and on each of
its builds' Overview (the factory's codes today, as the Commands tab's
labels are). It does nothing else with them for now. They are not the
[error codes](#error-codes) a failed build carries, which say why the build
failed.

BOB declares five (`minion/exits.go` in its minion):

| Code | Label |
|---|---|
| 1 | Could not start: for a reason without a code of its own (the minion's log says which) |
| 2 | Crashed: Go's own code for a panic no task recovered, or a fatal error of the Go runtime |
| 3 | Its config does not read |
| 4 | Built without core's keys |
| 5 | No connection it can use |

## Build files

Files for `file` fields (an icon, a signing certificate, a template binary) are
uploaded in the app before building. A build file belongs to an **operation**.
It has an id, a name, a size, a SHA-256 and a media type; its bytes live in
SeaweedFS and never change after upload. `accept` and `max_size` are checked
when the file is used in a value, not at upload, so one file can serve several
fields. Uploads are capped by a core setting (default 64 MiB).

A file is kept while a build record refers to it; an upload nothing refers to is
removed after a day. Deleting an operation deletes its files.

In a build request, a file value stays the file's id, and the request's
`files` holds each file the values name, under its id, with what the factory
needs to fetch it:

```json
{
  "id": "0f9a2c1e-6f1b-4a43-9d4e-2b9b3c1d7e55", "name": "app.ico", "size": 4286,
  "sha256": "9f2c…", "media_type": "image/x-icon",
  "url": "/api/factory/builds/5b0c4f6e-…/files/0f9a2c1e-…?expires=1793025060&sig=…"
}
```

`url` is a **link**: a path on core's address, which the factory `GET`s
from wherever it reaches core (its `LOGOS_CORE_BASE_URL`, core itself or its
front, with the same [TLS settings](../../core-infrastructure/#how-modules-reach-core)
as its other calls). Core signs it for the build and the file until a minute
past the build's deadline, and streams the file from its storage, which a
factory never reaches. The factory checks the size and SHA-256 after
downloading. A link that is not core's, another build's or expired is
refused (403), and so is any once the build has ended (409). The app
uploads build files with `POST /api/v1/build-files`.

## Connections

A build gives the minion one or more **connections**, in the order the minion
tries them. Each one is:

| Property | Meaning |
|---|---|
| `module_name` | The channel kind, one the target speaks. |
| `kind` | Optional. The connection kind, one the channel and the target both support ([Channel ↔ Core: Connections](../channel-core-connections/#kinds-in-the-build-schema-and-in-builds)); left out, the first of those in the factory's order. |
| `name` | Optional. What the minion calls the connection, a slug like an endpoint name, unique among the build's connections. Without one, it is `<channel>-<position>`, e.g. `http-1`. |
| `description` | Optional. The operators' note on what the connection is for, at most 500 characters. Core keeps it with the build record; it is never part of a build request. |
| `settings` | By the field key of the kind in the channel's [connection schema](../minion-connection/), validated like an endpoint's values. A field without a value takes its default. |
| `values` | The factory's [connection parameters](#connection-parameters) for that channel kind and connection kind. |
| `failover` | Optional. The connection's own [failover](../channel-core-connections/#failover) settings: `auto` (failover may move the minion here; `true` by default, `false` for `bind-persistent`) and `fail_after` (failures in a row before it moves off this one; the build's by default). |
| `max_message` | Set by core, never by the operator: the largest message the connection carries, its channel's [`max_message`](../channel-core-connections/#the-connection-schema-by-kind) for the kind (left out: 768 KiB). The build request carries it; the factory builds it in, and the minion keeps its messages within it. |

A build also has a **failover policy**, `failover`: how its minion moves
between those connections on its own ([Failover](../channel-core-connections/#failover)).
Keys left out take the defaults.

The build form fills a connection in from scratch or from one of the operation's
[endpoints](../minion-connection/#channel-endpoints), picked from a searchable
list of endpoints of kinds the connection can use: that copies the endpoint's
kind and values, its name (made unique among the connections) and its
description, unless the operator wrote their own, for the
operator to change as needed. The other way, **Save as endpoint** keeps a
connection's kind, settings, name and description as a new endpoint of the
operation, for later builds; the factory's parameters stay with the build.
Either way it is a copy: nothing refers back afterwards.

## The minion config

A factory that wants a build's settings the way a minion reads them,
numbered rather than named, declares `minion_config`. With each build request
core then also sends the **minion config**: the request's settings as CBOR
with numbered keys, base64 in the request's JSON (`minion_config`), beside the
same settings in JSON. It is a convenience, not a say in the artifact: what
goes into a minion, and in what form, is the factory's to decide. A factory
may bake the bytes in whole, take parts of them, or build its own from the
JSON; core never looks at what it builds. A minion handed the bytes reads them
with the decoder it reads core's messages with (`protocol.ReadMinionConfig`),
by numbers alone, so it carries no names of its settings, as it carries none
of its messages' ([Wire format](../minion-messages/wire-format/)). BOB
declares it from version 4 of its schema and bakes the bytes in whole; its
minion's numbers are in `minion/fields.go`.

**Why core makes it.** The numbers come from schemas: the factory's for its
channels, fields and connection parameters, and each channel's for that
channel's fields, which a factory does not have (an endpoint's settings come
to it by name). Core holds them all, at the versions the build's connections
follow, so it numbers the settings once, the same way for every factory, in
the forms a minion already reads in a task's arguments. A factory gets them
without knowing a channel's numbering or writing a translation, in any
language. The request itself stays JSON: servers read it, and the build's
JSON tab shows it as it went.

| Key | Value |
|---|---|
| 1 | The build id, 16 bytes. |
| 2 | The payload crypto suite and the minion's keys: `{1: suite, 2: enc key, 3: mac key}` for `aes-256-cbc-hmac-sha256`, 32 bytes each; `{1: suite, 4: material}` for a suite of the factory's own. Absent when the target's builds have no suite. |
| 3 | The envelope: `json`, or the factory's own; absent for `cbor`. |
| 4 | The connections, in the order the minion tries them (below). |
| 5 | The failover policy: `{1: enabled, 2: fail after, 3: fail for, 4: wrap, 5: cycle pause, 6: failback after}`, durations in milliseconds, a key that is 0 or false left out. |
| 6 | The commands the minion has, by `op`, in the schema's order. |
| 7 | Max tasks, as in the request; absent for a factory without `max_tasks`. |
| 8 | The compression the minion packs with, a packed item's `alg` (1, deflate); absent when off. |
| 9 | The persisted session it claims, 16 bytes; absent for none. |
| 10 | The build's values, by their fields' `num`. |

A connection is `{1: channel, 2: version, 3: kind, 4: params, 5: values,
6: failover, 7: max message}`: the channel's `num` in the factory's schema,
the version of the channel's connection schema it follows, the kind's
number (1 `reverse-call`, 2 `reverse-persistent`, 3 `bind-call`, 4
`bind-persistent`), the endpoint's settings by the channel's own [field
numbers](../minion-connection/#field-numbers), the factory's connection
parameters by theirs, the connection's `{1: auto, 2: fail after}`, and its
largest message (absent: 768 KiB). The endpoint's name is not in it.

A value takes the CBOR form a task's arguments take
([Tasks](../minion-messages/tasks-and-results/#tasks)): a duration in
milliseconds, a datetime in unix seconds, a list or a map as it is, and a
`credential` field's value the [credential](../credentials/#what-a-module-gets)
itself (a `credential_list`'s, the list), in place of the id; the minion
reads them with the same functions (`protocol.ArgString`, `ArgDuration`,
`ArgCredential`). A field with no value and every `file` field are left out:
a file's bytes are the factory's to handle. The request's links, deadline and actor are
not in it either: they are about the build, not its settings. Maps are
written in a deterministic order, so the same request gives the same bytes; a
config is 64 KiB at most.

Core makes it as it makes the request: when the build is created (one that
cannot be made refuses the build, `minion_config` among the problems), and
each time it offers it (one that cannot be made then fails the build,
`minion_config`). It cannot be made through a channel whose registered
connection schema is not the version the build's connections follow, or
was stored before numbers were required. factory-core checks it with the rest
of the request: present exactly when the schema declares it, readable, and
this build's (its id, and as many connections as the request).

## Building

```mermaid
sequenceDiagram
    autonumber
    participant OP as Operator
    participant CORE as Core
    participant F as Factory instance
    participant S3 as SeaweedFS
    OP->>CORE: build (description, factory kind, target, platform, commands, values, connections)
    CORE->>CORE: validate, fill in defaults, new build id → QUEUED
    CORE->>F: factory.build (links, deadline)
    F-->>CORE: accepted, with its plan (steps) → BUILDING
    F->>CORE: download files (the links)
    CORE->>S3: stream them from the store
    loop each step
        F->>CORE: factory.build.progress (the step it is on)
    end
    F->>CORE: upload artifact (its link)
    CORE->>S3: stream it into the store
    F->>CORE: factory.build.result
    CORE->>S3: check size and SHA-256
    CORE->>CORE: SUCCEEDED: minion and build record stored
```

### What core checks

Before anything is sent, core checks the request against the factory kind's
latest schema:

- the build has a `description`: what it is for, 1 to 500 characters, the
  operators' note (core keeps it, see [Build records](#build-records-and-minions));
- the target exists, and the platform is one of its `platforms`;
- the values follow the field rules (type, bounds, pattern, required, and **no
  undeclared keys**) for the shared fields plus the target's own;
- each command picked is one of the target's, picked once; core adds the
  target's required ones (see [Commands](#commands) for a build that leaves
  `commands` out);
- at least one connection is given (there is no upper limit), each through a
  channel kind the target supports, whose current connection schema `version`
  is one the factory lists, with a `name`, when it has one, that is a slug no
  other connection is called (see [Connections](#connections));
- each connection's kind is one the target and the channel both support, its
  settings follow that kind's fields in the connection schema, and its values
  the connection parameters the factory declares for that channel kind and
  connection kind, by the same rules;
- a live instance of the kind declares that latest `version`.

A value of `null`, `""` or `[]` leaves its field unset. Defaults are then
filled in, as in an endpoint export: the factory and the build record get
concrete values, never a schema to interpret. Last, core runs the factory's
own check (`ValidateBuildRequest`, the one factory-core runs) on the request it
would send, so a build it queues is one the factory takes.

### Choosing an instance

Core offers a queued build to the registered instances of its kind that
declare the build's schema version (the latest when the build was made), one
after another, starting at a different instance each time so builds spread
out:

- an instance that replies `busy`, does not answer within 10 seconds, or
  replies without accepting (`accepted` false, or another `build_id`) is
  passed over, and core tries the next one;
- an instance that replies with any other error (`validation_failed`,
  `unsupported_version`, …) refused the build, and core fails it (`refused`);
- when no instance takes it, the build stays `QUEUED`, and core offers it again
  on its next pass, every 2 seconds;
- when no registered instance declares the build's schema version any more,
  and the kind's latest schema is another version, core fails the build
  (`schema_changed`): build it again against the current schema. Under the
  same version it waits, since the instances may be restarting.

How many builds an instance runs at once is the factory's own setting, which
operators change live, and a drained instance replies `busy` to every new build
(see [Managing a factory](#managing-a-factory)). Several core instances share
the queue: one claims a queued build while it offers it, so two never offer the
same build at once.

### Operations

| `type` | Direction | Summary |
|---|---|---|
| `factory.build` | core → factory | Start a build. |
| `factory.build.cancel` | core → factory | Stop a build. |
| `factory.build.progress` | factory → core | Report the step of its plan a running build is on. |
| `factory.build.result` | factory → core | Report how a build ended. |

Core calls the factory on its `rpc_queue` (`logos.factory.rpc.<instance>`), as
for [management](../module-management/#transport). The factory calls core on
`logos.core.rpc`, as for [lifecycle](../module-lifecycle/#transport). All four
are request/reply.

---

### `factory.build`

Request `payload`:

```json
{
  "build_id": "5b0c4f6e-8a1d-4c2b-9e7f-3d2a1b0c9e8f",
  "target": "windows-exe",
  "platform": "windows/amd64",
  "schema_version": 1,
  "values": {
    "kill_date": "2027-01-31T00:00:00Z",
    "guardrails": ["domain_joined"],
    "debug": false,
    "icon": "0f9a2c1e-6f1b-4a43-9d4e-2b9b3c1d7e55"
  },
  "commands": ["sleep", "exit", "shell", "download", "screenshot"],
  "connections": [
    {
      "endpoint": {
        "format": "logos.channel-endpoint.v2",
        "name": "edge-eu",
        "channel": { "module_name": "http", "schema_version": 3 },
        "kind": "reverse-call",
        "params": { "base_url": "https://edge-eu.example.com", "tls_verify": false, "request_timeout": "40s" }
      },
      "values": { "method": "POST", "path_prefix": "/cdn/assets/" }
    }
  ],
  "files": {
    "0f9a2c1e-6f1b-4a43-9d4e-2b9b3c1d7e55": {
      "id": "0f9a2c1e-6f1b-4a43-9d4e-2b9b3c1d7e55", "name": "app.ico", "size": 4286,
      "sha256": "9f2c41d0e5a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2",
      "media_type": "image/x-icon",
      "url": "/api/factory/builds/5b0c4f6e-…/files/0f9a2c1e-…?expires=1793025060&sig=…"
    }
  },
  "crypto": { "suite": "aes-256-cbc-hmac-sha256", "material": { "enc_key": "<base64, 32 bytes>", "mac_key": "<base64, 32 bytes>" } },
  "artifact": { "upload_url": "/api/factory/builds/5b0c4f6e-…/artifact?expires=1793025060&sig=…", "max_size": 268435456 },
  "deadline": "2026-10-26T14:30:00Z",
  "actor": { "type": "user", "id": "f140266c-…", "name": "admin" }
}
```

| Field | Meaning |
|---|---|
| `build_id` | UUIDv4, the identity of the build and of the minion it makes: every build operation names the build by it, and the minion sends it on the [data plane](../channel-core-sync/), where the channel passes it to core as `Logos-Build-Id`. A repeated `build_id` is the same build. |
| `target`, `platform`, `schema_version` | What to build, against which version of the factory's schema. |
| `values` | Every field of the target that has a value or a default. A `file` field holds the file's id. |
| `commands` | The ids of the [commands](#commands) the minion is built with: those picked, the target's required ones among them, in the schema's order. The minion has these and no others. |
| `files` | The files the values name (connection parameter values included), by id, as in [Build files](#build-files). |
| `credentials` | The [credentials](../credentials/#what-a-module-gets) the values, the connections' `values` and their endpoints' `params` name, by id: each its `id`, `name`, `type` and the fields of its type that hold a value. Secret, as the values: for the build only. |
| `connections` | The [connections](#connections), in the order the minion tries them: each one's settings as an endpoint [export](../minion-connection/#the-export) under `endpoint` (its `name`, channel kind, schema version, connection `kind`, and `params` with defaults filled in), its [connection parameter](#connection-parameters) `values`, defaults filled in, and its own `failover` settings when it has any. |
| `failover` | The build's [failover policy](../channel-core-connections/#failover), defaults filled in: `enabled`, `fail_after`, `fail_for`, `wrap`, `cycle_pause`, `failback_after`. Sent whatever the factory declares; one that does not declare `failover` may ignore it. |
| `crypto` | Present when the target's builds have a suite: its `suite` and the minion's key `material`, fresh for every build. For `aes-256-cbc-hmac-sha256`: `enc_key`, the AES-256 key, and `mac_key`, the HMAC-SHA256 key, 32 random bytes each in base64. For a suite of the factory's own: the material the factory made for the build over its [factory link](../minion-messages/codecs/#the-factory-link), base64 (the build waits in the queue until it has it). The factory puts them in the artifact and keeps them nowhere else. |
| `envelope` | Present when the target's envelope is not `cbor`: `json`, or the factory's own. |
| `max_tasks` | Present for a factory that declares `max_tasks`: how many tasks the minion runs at once as it starts, 0 (none until a session sets more) to 64; 5 unless the operator set another. The factory builds it in. |
| `compression` | Present for a factory that declares `compression`, unless the operator turned it off: the algorithm the minion packs and inflates (`"deflate"`). The factory builds it in. Protocol v0.47.0. |
| `minion_config` | Present for a factory that declares `minion_config`, and only then: the [minion config](#the-minion-config), this request's settings numbered, base64. What of it goes into the minion is the factory's to decide. |
| `session_id` | Present for a build with a persisted session (only to a factory that declares `persisted_sessions`): the session the minion claims in its `hello`, a lowercase UUID; an existing session, or one core reserved with the build. The factory builds it in. |
| `artifact` | Where to upload the artifact: `upload_url`, a link (as a file's [`url`](#build-files)) to `PUT` it to, with its length (`Content-Length`; none: 411), valid until a minute past the deadline, and `max_size`, the largest artifact the factory may upload (a core setting, default 256 MiB). factory-core refuses to upload a larger one (`artifact_too_large`); core refuses one over the build's limit before reading a byte (413), and holds the factory to it by its result too: see [`factory.build.result`](#factorybuildresult). A second upload replaces the first. |
| `deadline` | When core stops waiting: the build timeout after the offer. |
| `actor` | Who started the build, for the factory's own logs. |

The factory validates the request again, as a module validates configuration,
since only it knows its build-time constraints. It replies at once, before
building, with its **plan** for the build:

```json
{
  "build_id": "5b0c4f6e-8a1d-4c2b-9e7f-3d2a1b0c9e8f",
  "accepted": true,
  "steps": [
    { "id": "fetch", "label": "Fetch files" },
    { "id": "compile", "label": "Compile" },
    { "id": "sign", "label": "Sign" },
    { "id": "upload", "label": "Upload" }
  ]
}
```

`steps` are what the factory will do for this request, in order: 1 to 32, each
an `id` (`^[a-z0-9][a-z0-9_-]{0,62}$`, unique in the plan) and a `label` for
the operator (1 to 64 characters, one line). The plan is the build's, not the
target's: a step that will not run for these values is left out. Core shows it
as the build's [pipeline](#the-pipeline). A plan core cannot take (none, or an
invalid one) does not stop the build; it shows as a single step, "Build".

Or the factory replies with an error: `validation_failed` (also for a deadline
already past), `busy`, or `unsupported_version` (the request's `schema_version`
is not the one this instance declares). After `busy` core tries another
instance; any other error fails the build (see
[Choosing an instance](#choosing-an-instance)).
A repeated request for a build it already accepted is accepted again, with the
same plan, and never builds twice; for one that finished, the factory sends its
result again. factory-core remembers a build for an hour past its deadline.

Key material, secret values and files are only for the build. The factory must
not log them, keep them after the build, or put them in progress messages or
the build log.

### `factory.build.progress`

Request `payload`:

```json
{ "build_id": "5b0c4f6e-8a1d-4c2b-9e7f-3d2a1b0c9e8f", "step": "compile", "message": "Compiling windows/amd64" }
```

`step` is the `id` of the step of the plan the factory is now on; reporting
it again changes its optional `message` ("compiling 3 of 10"), and one without
a message clears it. Core keeps when each step was first reported and its
latest message. A step outside the plan is ignored. Progress is best effort: a
lost report is not sent again, and core takes the steps before the one
reported as done, so a lost one only costs a step its times.

`message` is at most 1,000 bytes. Reply `payload`:
`{ "build_id": "…", "ack": true }`. A `not_found` error means core no longer
waits for the build from this instance (it was cancelled, ran out of time, or
is another instance's), and the factory should stop it.

### `factory.build.result`

Request `payload` when the build succeeded:

```json
{
  "build_id": "5b0c4f6e-8a1d-4c2b-9e7f-3d2a1b0c9e8f",
  "status": "succeeded",
  "artifact": {
    "filename": "WinTelemetry.exe", "size": 2412544,
    "sha256": "28afe4a10a4a7d593623dcd1eee11f519b056d2bfdda4c7b0bd7a57fc3a5fc8b",
    "media_type": "application/vnd.microsoft.portable-executable"
  },
  "warnings": ["debug build: strings are not obfuscated"],
  "log": "…"
}
```

and when it failed:

```json
{
  "build_id": "5b0c4f6e-8a1d-4c2b-9e7f-3d2a1b0c9e8f",
  "status": "failed",
  "error": { "code": "compile_failed", "message": "go build exited with status 1" },
  "log": "…"
}
```

- The artifact is uploaded to `artifact.upload_url` before the result is sent.
- What the minion can do is no part of the result: it is the request's
  `commands`, which the factory built in, or it failed the build.
- `warnings` and `log` (the build output, its last 64 KiB) are shown with the
  build; the log matters most when it fails.
- `error.code` is the factory's own, e.g. `compile_failed`: a slug,
  `^[a-z0-9][a-z0-9_.-]{0,62}$`. factory-core reports some
  [codes of its own](../../implementing-a-module/#results-and-failures).
- Limits: up to 32 warnings, each, like `error.message`, at most 1,000 bytes;
  the log at most 64 KiB; the artifact's `filename` a plain file name (no
  path) of 1 to 255 bytes; `sha256` 64 lowercase hex digits. Core refuses a
  result outside them (`validation_failed`).

A failed result finishes the build at once, and so does a succeeded one whose
artifact is larger than the `max_size` the instance was given
(`artifact_too_large`): core deletes the upload unread. For any other
succeeded result, core checks the stored artifact's size and SHA-256 against
the result, in the background, before it marks the build `SUCCEEDED`, reading
no more of it than the size reported. An artifact that is missing or differs
fails the build with `artifact_mismatch`, and a differing one is deleted. When
the store cannot be read, core keeps trying until an hour past the deadline,
then fails the build the same way.

Reply `payload`: `{ "build_id": "…", "recorded": true }`. The factory sends the
result again until it gets a reply or the deadline passes, and a repeated result
is answered the same way. A `not_found` error means core no longer waits for the
build: the factory drops the result.

### `factory.build.cancel`

Request `payload`: `{ "build_id": "…" }`. Reply `payload`:
`{ "build_id": "…", "cancelled": true }`, also for a build the factory does not
know, which it remembers: a `factory.build` for it that arrives later is
accepted and never built. The factory stops the build, throws away what it
produced and sends no result. Core marks the build `CANCELLED` first, whatever
the reply, also when the instance cannot be reached, and answers a result that
still arrives with `not_found`.

---

## Build states

| State | When |
|---|---|
| `QUEUED` | Core accepted the build and waits for a factory instance to take it. |
| `BUILDING` | Offered to an instance, and taken by it. Core marks it before the offer: a factory reports as soon as it accepts, which can be before its reply arrives. An instance that does not take it puts it back to `QUEUED`. |
| `SUCCEEDED` | The result arrived and the artifact checked out. The minion exists from now on. |
| `FAILED` | The factory reported a failure, or core gave up on the build for one of [its own reasons](#error-codes). |
| `CANCELLED` | An operator cancelled it, or its operation was deleted. |

The build timeout is a core setting (default 30 minutes) and applies to the
time a build spends queued and to the time it spends building; `deadline` in
the request is when the latter runs out. An offer an instance turns down
leaves the build's time in the queue as it was.

A factory instance that stops cleanly cancels its running builds and reports
them failed (`shutdown`) before it deregisters, waiting up to 10 seconds for
the reports to go out. Core fails a build still running on an instance that is
no longer registered (deregistered, declared dead or blocked) with
`factory_lost`, on its next pass. A factory that crashes and is back under the
same instance id before core declares it dead has lost its builds without core
noticing: they fail at their deadline (`timeout`).

### The pipeline

The app shows a build as a pipeline of stages: core's **Queued** (until an
instance takes the build), then the factory's plan, then core's **Check
artifact** (from the result to the size and SHA-256 check). Core works the
stages out from the build record whenever it is read:

| State | A stage that |
|---|---|
| `PENDING` | the build has not reached yet. |
| `RUNNING` | the build is in: the step last reported, or the plan's first step once the build is taken and nothing is reported yet. |
| `SUCCEEDED` | is behind the build: every step before the one reported, and every step once a succeeded result arrived. |
| `FAILED`, `CANCELLED` | the build ended in: the step it was on when the factory reported a failure, core gave up on it or an operator cancelled it; Check artifact when the artifact did not check out. |
| `SKIPPED` | the build ended before. |

Queued runs from when the build was made until an instance took it. A step's
times are known when it was reported: it starts at its first report and ends
when the next reported step starts, or with the factory's result (or the end of
the build). A step done without a report has no times, except the plan's first
step, which starts when the instance took the build while nothing is reported
yet. Check artifact runs from the result to the end of the check.

## Build records and minions

Core keeps a **build record** for every build: who started it, when and what
for (its description), the factory kind, instance and version,
`schema_version`, target, platform, values (`file` values as build file ids),
its commands, the connection settings as copied with the operators'
descriptions of them, the factory's plan and step reports, the state, who
cancelled it, and the result: artifact, warnings and log, or the error. It
also keeps the minion's payload crypto suite and keys: sent to the factory
building it, and shown to operators under `crypto` in the build's JSON. A new
build pasted from that JSON ignores them and gets keys of its own.

A successful build creates the **minion**: identified by `build_id`, with its
factory kind, target, platform, who built it, and its build's commands as what
it can do, and core holds its keys. A failed or
cancelled build creates none, and its build id is never used again.

**Every build is a new minion.** Building again from a record opens the build
form filled in from it, so every earlier build is the template for the next:
its description, target, platform, commands, values and connections with theirs, values
equal to today's defaults left out so they read as defaults. The new build gets
a new build id and new keys: two artifacts never share
an identity.

An artifact is kept until an operator deletes it (the build record stays) or
the operation is deleted, which deletes its builds, artifacts, build files and
minions, and cancels its unfinished builds.

An operator can also **delete a build**, whatever its state. An unfinished
build is cancelled first, on its factory too. The build record, its artifact
and the minion it made are removed for good; the operation's build files stay,
and become deletable once no build refers to them. A minion of a deleted build
that is already out can no longer open a session: core no longer has its
keys. Artifacts will hold the minion's
keys, so only operators download them, always as an attachment.

## Who can do what

| Who | Can |
|---|---|
| Viewer of the operation | see its builds, build records, minions and build files |
| Operator or admin of the operation | also upload build files and delete ones no build refers to, build, cancel builds, download artifacts and delete them, delete builds |
| Agent API key | nothing: builds are not on the MCP surface, the only one agent keys reach |

App admins can do everything in every operation, and in the Public operation
every signed-in user counts as an operator.

Every signed-in user also sees the factory kinds: each one's current build
schema, its icon, and how many registered instances declare that schema (a
build needs one). The forms are built from it.

## Managing a factory

A factory is [managed](../module-management/) like any module: it declares
properties, actions and status values in its manifest and can serve the
[live log tail](../module-logs/). Its builds, though, run inside the SDK, so
**factory-core adds a builds section** to every factory's management, next to
what the factory declares itself (or as all of it, when the factory declares
nothing). Core sees an ordinary manifest:

| | Key | |
|---|---|---|
| Property | `max_concurrent_builds` | `int`, `live`, group "Builds", 1 to 64 (or to the factory's own setting, when higher). How many builds the instance runs at once; a `factory.build` beyond it gets `busy`. Starts at the factory's own setting (1 unless it sets one). Lowering it lets running builds finish. |
| Action | `drain` | Risk `high`. Take no new builds (`busy`) until resumed; running builds finish. A repeated `factory.build` for a build already accepted is still accepted. Available while not draining. |
| Action | `resume` | Take builds again. Available while draining. |
| Status | `builds_running` | Builds running now. |
| Status | `builds_accepted_total`, `builds_succeeded_total`, `builds_failed_total`, `builds_cancelled_total` | Since the process started. Cancelled: core cancelled the build or no longer waited for it. |
| Status | `builds_refused_total` | `busy` replies: at the limit, drained or stopping. |
| Status | `last_build_failure`, `last_build_failure_at` | The last failed build's `code: message`, and when (`datetime`). |
| Status | `draining` | `bool`, alert on `true`. |

These keys are taken: a factory's own manifest cannot use them. The Go SDK adds
the section with module-core's `mgmt.Server.Extend`, which runs the factory's
own `ApplyFunc` first, so a change the factory refuses never reaches the
section.

## Error codes

Why a build failed: the factory's answers and core's own reasons. What a
minion's exit code means is another table, the factory's
[minion error codes](#minion-error-codes).

| Code | Used in | Meaning |
|---|---|---|
| `validation_failed` | all | Malformed payload, or a request the factory cannot build. |
| `busy` | `factory.build` | The instance runs as many builds as it may, is drained, or is stopping. |
| `unsupported_version` | `factory.build` | The request's `schema_version` is not the one this instance declares, or the envelope's major version is unknown. |
| `not_found` | `factory.build.progress`, `factory.build.result` | Core no longer waits for this build. |
| `internal_error` | all | Unexpected failure. |

Core's own reasons for a failed build, kept in its record next to the
factory's codes:

| Code | When |
|---|---|
| `timeout` | No instance took the build within the build timeout, or its result had not arrived by the deadline. |
| `factory_lost` | The instance building it is no longer registered: it deregistered, was declared dead, or was blocked. |
| `refused` | The instance offered the build answered with an error other than `busy`. |
| `schema_changed` | No registered instance declares the build's schema version any more, and the factory kind's latest schema is another version. |
| `artifact_too_large` | The result reports an artifact larger than the `max_size` the instance was given. The upload is deleted. |
| `artifact_mismatch` | The artifact the result reports is not in the store, differs in size or SHA-256, or could not be read to check it until an hour past the deadline. |
| `minion_config` | The [minion config](#the-minion-config) the factory reads cannot be made as core offers the build: a channel of the build follows another connection schema version now, or its stored schema predates required numbers. |

## Settings

Core's settings for builds:

| Setting | Default | |
|---|---|---|
| `BUILD_TIMEOUT` | `30m` | The [build timeout](#build-states), queued and again building. |
| `BUILD_FILE_MAX_SIZE` | 64 MiB | The largest [build file](#build-files) upload, at most 1 GiB. |
| `BUILD_ARTIFACT_MAX_SIZE` | 256 MiB | The artifact's `max_size` in a build request, at most 1 GiB. A build keeps the one it was offered with. |
| `BUILD_BUCKET` | `logos-builds` | The SeaweedFS bucket for build files and artifacts. |

## In the app and the API

**Builds** lists an operation's builds, newest first and live while they run,
with search and filters by state and factory. **New build** opens the build
form, made from the factory's schema: what to build (description, target,
platform), the commands as two lists, available and selected, with the
required ones fixed in place, the build parameters in the factory's groups,
and the connections; a JSON tab edits the same build as JSON. A build opens on
its **Pipeline** while it is queued or running, or when it failed or was
cancelled, and on its **Overview** once it succeeded; its **Connections**,
**Commands**, **Targets** (for a build with a `bind` connection) and **JSON**
are beside them. The JSON tab has two views: **Build**, what it takes to build
it again, which pastes into a new build's JSON tab, and **Sent to factory**,
the `factory.build` request core sent, exactly as it went: core keeps the
payload's bytes when it offers the build (and drops them when that instance
does not take it), and Download saves those bytes, to work on a factory away
from core. Operators cancel a build there while it runs, download or delete its
artifact, **Build again**, and delete the build (also from the row's menu in
the list). A factory's page under Modules shows what it builds: its targets,
build parameters and commands, each with its number (a field's `num`, a
channel's in its connection rows, a command's `op` and its params' `num`s),
for whoever writes a minion that reads them. The GraphQL types carry them too
(`ModuleField.num`, `BuildChannel.num`, `BuildCommand.op`). Its
[minion error codes](#minion-error-codes) are there as well, and on each of
its builds' Overview (`BuildSchema.errorCodes`).

The API is GraphQL: the queries `factoryKinds`, `buildFiles`, `builds` (paged,
with the same search and filters), `build` (its `request` is the
`factory.build` request as sent, JSON text) and `minions`, and the mutations
`createBuild` (problems by place in the error's `extensions.problems`),
`cancelBuild`, `deleteBuild`, `deleteBuildArtifact` and `deleteBuildFile`. Bytes go over REST:
`POST /api/v1/build-files` uploads a build file (multipart: `operationId` and
`file`; 413 when it is too large), and `GET /api/v1/builds/{id}/artifact`
downloads an artifact.

## Design notes

- **Targets, not conditional fields.** What differs between a service
  executable and shellcode is mostly which parameters apply. A closed list of
  targets with their own fields is easy to validate and to render. Fields that
  show or hide depending on other values would need every consumer to evaluate
  conditions.
- **The factory states what its minions speak, and core checks it before
  building.** A minion reads one version of a channel's parameters. When a
  channel releases a new connection schema version, a factory that does not
  list it cannot build for that channel until it is updated, and the app says so
  instead of producing a minion that cannot read its own settings.
- **Connection parameters belong to the factory.** How a minion uses a channel
  (which method, which path) is the minion family's behaviour, not the
  channel's: the HTTP channel accepts whatever arrives. Keeping them out of the
  channel schema also keeps endpoints shareable by every factory. They travel
  next to the endpoint export rather than inside it, so a channel that later
  adds a field with the same key changes nothing for minions already built.
- **Core numbers the settings; the factory decides what to bake.** Numbering
  needs schemas only core holds together (each channel numbers its own
  fields), so core makes the numbered form once, alike for every factory, and
  sends it beside the JSON. Its part ends there: core neither knows nor
  checks what a factory builds into its minion, and a factory may use the
  config whole, in part, or not at all. Sending the whole request in CBOR
  instead would still leave the channels' fields for each factory to number,
  and would put the build's links, deadline and actor in the same blob as
  the settings, so baking it whole would no longer be safe.
- **Every module numbers its fields.** Channels and factories number every
  field (target fields and files too) whether anything reads them by number
  yet or not: numbers cost a schema nothing, a config can be made for any
  build through any channel, and a later reader by number (a target's values,
  a file) needs no new rule.
- **A build is building before it is offered.** A factory accepts a build and
  starts on it at once, reporting progress as it goes; its reply can reach core
  after its first report. Core therefore records the build as building on an
  instance before offering it there, and puts it back in the queue when the
  instance is busy or does not answer, so no report finds the build not yet
  its instance's.
- **The SDK manages what it runs.** A factory's builds run inside
  factory-core, so only the SDK can count them, refuse new ones or change how
  many run at once. It serves that management itself, with the same keys on
  every factory, rather than leaving each factory to expose its internals.
- **Core owns identity and keys.** Core generates the build id, and will
  generate its keys with payload crypto. The keys will only pass through the
  factory into the artifact: never in a form or a build record.
- **Files and artifacts through core.** A build's links are core's own, paths
  on the address the factory already reaches core at, signed for that build:
  a factory needs no storage credentials and reaches only the objects of the
  build at hand, and works wherever it reaches core. Until 2026-11-10 they
  were presigned URLs of the store itself, which a factory on another host
  could not resolve (`seaweedfs-s3` is a name on core's network) and which
  would have sent a minion, its keys inside, to the store unencrypted; core
  now streams the bytes and caps an upload by its length. SHA-256 checks on
  both sides catch a damaged transfer, and core still holds a factory to
  `max_size` by the size its result reports, never reading more of an
  artifact than that.
- **Asynchronous, with progress and results as calls to core.** A build takes
  minutes, while management actions are synchronous and capped at 60 s. A result
  must be acknowledged, and a factory must learn when core gave up on a build,
  so progress and results are calls to `logos.core.rpc` rather than events on
  `logos.events`, as the [routing conventions](../amqp-conventions/#events-publishsubscribe)
  sketched.
- **Connections hold their own settings.** Endpoints spare retyping, but a
  build often needs a variation of one (another front, a different timeout) or
  a one-off address, and making an endpoint first meant leaving the build form.
  So a build's connection is filled in on the spot, from scratch or from an
  endpoint, and keeps its own copy: changing an endpoint changes nothing
  already built.
- **Notes stay in core.** Whatever a factory gets may end up inside the
  artifact, readable by anyone who captures the minion. A build's description
  and its connections' are the operators' notes ("dry run for the EU front"),
  so core keeps them in the build record and leaves them out of the request,
  the same way an endpoint's description is not part of its export.
- **Every build is a new minion.** Rebuilding the same identity would leave two
  artifacts answering as one minion.
- **Steps declared up front.** A percentage is a guess each factory makes its
  own way, and says neither what is happening nor where a build failed. A plan
  shows the whole build before it runs, and the step it fails in. It comes
  with the acceptance, an answer core always gets, rather than with progress,
  which may be lost: core then works out each stage from what did arrive.
- **Earlier builds are the templates.** Named presets of build settings were
  dropped before release: every build record already holds a complete set of
  settings that built, and Build again starts from it. A second kind of saved
  settings needed its own list, its own checks against changing schemas and its
  own hold on build files, for what a build record already gives.
- **Commands picked per build.** A minion that can do more than its job needs
  is more to find and more to lose when it is caught. So the factory declares
  what its minions can do, and the operator picks what each one does, the way
  they pick its target and values. What a minion can do is then known before
  it is built, from the build record, rather than reported by the factory
  afterwards. How tasks reach a command and what comes back belongs to the
  tasking contract, not written yet; `params` are declared now so a command
  is described whole.
- **`file` only in build schemas.** Only a build hands files to a module,
  and a command hands them to its minion. A property or an endpoint holding
  a file would need its own way to deliver it.
- **Minion error codes are only shown.** An exit code is all a minion that
  cannot start leaves behind, and only its factory knows what its own mean.
  So the factory declares them, and core shows them where an operator looks
  up a minion: nothing in core acts on a code yet. A code is a byte so that
  it means the same on every OS a target runs on.
