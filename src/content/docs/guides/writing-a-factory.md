---
title: "Writing a Factory"
---

A factory builds minions. It declares a [build
schema](../../contracts/minion-build/#the-build-schema) when it registers;
core turns each build an operator makes into a `factory.build` request, and
the factory builds an artifact with the minion's keys and settings in it,
uploads it to core and reports how the build ended. This guide builds one with
the Go SDK, `logos-golang-factory-core`. [Implementing a
Module](../../implementing-a-module/) has what every module does, [Minion
Build](../../contracts/minion-build/) is the contract, and [Writing a
Minion](../writing-a-minion/) is what the minion it builds has to speak. The
examples are for the example build schema in [Minion
Build](../../contracts/minion-build/#the-build-schema).

## How a build goes

1. **Registration.** `factory.Run` registers the instance as module type
   `factory`, with its build schema under `build`. Core refuses a schema
   that is not valid (`validation_failed`), and `factory.Run` checks it the
   same way before it connects.
2. **The request.** An operator builds. Core checks the build against the
   schema, fills in defaults, makes the minion's keys (and its [minion
   config](#the-minion-config), for a schema that asks), and offers
   `factory.build` to the kind's instances, one after another, until one
   takes it ([Choosing an
   instance](../../contracts/minion-build/#choosing-an-instance)).
3. **The reply.** The SDK checks the request and answers at once: accepted,
   with the build's plan, or `busy`, `validation_failed` or
   `unsupported_version`.
4. **The build.** The builder fetches the build's files from core, puts the
   keys and settings into the minion, reports the step it is on, and
   uploads the artifact to core.
5. **The result.** The SDK sends `factory.build.result` until core records
   it. Core checks the stored artifact's size and SHA-256, and the build
   succeeds.

Core may cancel a build at any point (`factory.build.cancel`). The whole
exchange is in [Building](../../contracts/minion-build/#building).

## Wiring

A factory is a `Builder` handed to `factory.Run`, in its `main`:

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
defer stop()

// Logs on stderr at the managed level, and in core's live tail.
var level slog.LevelVar
logs := logstream.New(instance)
logger, err := logging.New(os.Getenv("LOG_FORMAT"), os.Stderr, &level, logs)
if err != nil {
    log.Fatal(err)
}
slog.SetDefault(logger)

mgmtSrv, err := newManagement(b, &level) // the factory's own properties and actions
if err != nil {
    log.Fatal(err)
}
schema := buildSchema // a protocol.BuildSchema
err = factory.Run(ctx, factory.Config{
    Config: module.Config{
        AMQPURL: amqpURL(), // from RABBITMQ_HOST, _PORT, _USER, _PASSWORD, _VHOST
        Identity: lifecycle.Identity{
            ModuleName: "example",
            Instance:   instance, // FACTORY_ID: one per running process
            Version:    version,
        },
        Management: mgmtSrv, // factory-core adds the builds section
        Logs:       logs,
    },
    Build:               &schema,
    Builder:             b,
    MaxConcurrentBuilds: 4,
    CoreURL:             os.Getenv("LOGOS_CORE_BASE_URL"), // core, or its front
})
if err != nil {
    log.Fatal(err) // an invalid config or build schema: nothing was served
}
```

`factory.Run` runs until `ctx` ends. Then it cancels the running builds,
waits up to `ShutdownGrace` for their results to reach core, and
deregisters; so a factory hands it its signal context directly. It returns
an error only for an invalid config, at once.

| `factory.Config` | |
|---|---|
| `Config` | The module session ([With the Go SDKs](../../implementing-a-module/#with-the-go-sdks)): `AMQPURL`, `Identity` (module type `factory` by default, any other refused), `Management`, `Logs`, `Handlers` (which may not take `factory.build` or `factory.build.cancel`). |
| `Build` | The build schema. Required; checked as core checks it (`protocol.ValidateBuildSchema`). |
| `Builder` | Builds the minions. Required. |
| `MaxConcurrentBuilds` | Builds at once, 1 by default, and where the live `max_concurrent_builds` property starts. A `factory.build` past it gets `busy`. |
| `CoreURL` | Core's base URL, `http(s)://host[:port]`: core itself or its front. Required: a build's files and its artifact go through core (the links a request carries are paths on it), and a translating factory's link opens there. |
| `HTTPClient` | For those transfers. By default module-core's `coretls.Client()`, which trusts core as the environment says ([How modules reach core](../../core-infrastructure/#how-modules-reach-core)). It needs no timeout: each transfer ends with its build's deadline. |
| `ShutdownGrace` | How long a stopping factory waits for the results of the builds it cancelled: 10 s by default. |
| `Codec` | The layers of the minions' codec that are the factory's own: required when the schema names a suite or an envelope of its own, refused otherwise ([below](#a-codec-of-its-own)). |
| `Composers` | The code of the schema's composite commands, a `Composer` by command id: required for each, refused for another id ([below](#composite-commands)). |
| `MaxConcurrentDecisions` | Calls about composite commands' tasks answered at once, 4 by default: one past it gets `busy`, and core calls again. |
| `FactoryCommands` | The code of the schema's factory commands, a `FactoryCommand` by command id: required for each, refused for another id ([below](#factory-commands)). |
| `MaxConcurrentCommands` | Factory commands' tasks run at once, 4 by default: one past it gets `busy`, and core offers it to another instance, or again. Draining the instance stops new ones too. |

The SDK adds a [builds section](../../contracts/minion-build/#managing-a-factory)
to the factory's management (`max_concurrent_builds`, `drain`, `resume`,
build counters), next to the factory's own manifest or as all of it.

### A codec of its own

A factory whose minions cannot speak core's codec (the CBOR envelope, the
`aes-256-cbc-hmac-sha256` suite) names a suite or an envelope of its own in
its schema, `<module_name>.<name>`, declares what its translation may take
(`codec`), and gives `factory.Run` a `Codec`. Run keeps the [factory
link](../../contracts/minion-messages/codecs/#the-factory-link) open (core
refuses it, 403, until the instance is registered) and answers core's calls
with the codec's three methods, one call per message each way:

```go
schema.Crypto = "acme.xchacha"
schema.Codec = &protocol.BuildCodec{Growth: 120, Overhead: 64, Timeout: "2s"}

err := factory.Run(ctx, factory.Config{
    Config:  module.Config{AMQPURL: amqpURL, Identity: id},
    Build:   &schema,
    Builder: builder,
    Codec:   acmeCodec{}, // Inbound, Outbound, Keys
    CoreURL: coreURL,
})
```

| Method | Core asks |
|---|---|
| `Inbound` | Read a minion's message: open it with one of the candidate keys (the factory's suite), decode it (its envelope), and say which key opened it. |
| `Outbound` | Write core's message: encode it (its envelope), seal it with the id's key (its suite). |
| `Keys` | Make the suite's keys for a build, or for a stage, wrapped for the `stage` item's key; `codeclink.Refused` for a suite without staging. |

`codeclink.NotOpened`, `NotMessage` and `Refused` are the failures core
tells apart; any other error goes as other. In tests, `codeclink.Answer`
runs one call in process, and `factorytest.NewCore` is core's end of a real
link. [Codecs](../../contracts/minion-messages/codecs/) is the contract.

### Composite commands

A composite command's task runs the session's other commands as subtasks,
before and after the command's own op, as the factory's code decides ([Task
Outsourcing](../../contracts/task-outsourcing/)). `factory.Run`
gets each composite command's code, a `Composer`, by command id:

```go
err := factory.Run(ctx, factory.Config{
    Config:    module.Config{AMQPURL: amqpURL, Identity: id},
    Build:     &schema,
    Builder:   builder,
    Composers: map[string]factory.Composer{"archive": archive{}},
    CoreURL:   coreURL,
})
```

Run answers core's calls (`factory.compose`), each within its deadline,
`MaxConcurrentDecisions` at once. `Compose` gets the call
(`factory.ComposeCall`: its event, the task's args, the end that brought it,
the ctx the task's decisions left) and returns a `factory.Decision`:
`RunSubtasks`, `RunOwnOp`, `Cancel` or `Finish`, with `After` for a timer
and `Ctx` for what the next call needs. The contract's page has a whole one
([A factory's code](../../contracts/task-outsourcing/#a-factorys-code)). A
call's helpers read an end's data and output when they came by link, fetch
the files ends list, and put a file for the task (`PutFile`) that a later
subtask may send. In tests, `factorytest.Compose` answers one call as Run
would.

### Factory commands

A factory command is one the factory runs itself, never a minion: every
session of its builds has it ([Factory
Commands](../../contracts/factory-commands/)). `factory.Run` gets each one's
code, a `FactoryCommand`, by command id:

```go
err := factory.Run(ctx, factory.Config{
    Config:          module.Config{AMQPURL: amqpURL, Identity: id},
    Build:           &schema,
    Builder:         builder,
    FactoryCommands: map[string]factory.FactoryCommand{"whois": whois{registry: reg}},
    CoreURL:         coreURL,
})
```

Run accepts core's calls (`factory.command`) at once,
`MaxConcurrentCommands` at a time, and calls the command's `Run` with the
task (`factory.CommandTask`: the command's args, the session and its build,
the files and credentials the args name). What it writes to `Out` goes to
core as it comes; it returns a `factory.CommandResult`, or an error, which
fails the task. Its context ends when the task is stopped, when core no
longer waits for it, or when the factory stops. The contract's page has a
whole one ([A factory's code](../../contracts/factory-commands/#a-factorys-code)).
In tests, `factorytest.Command` runs one task as Run would, filling in a
session and its build when the call has none.

## The builder

A builder that compiles its minion, with the build's icon when it has one
(a `file` field of the example's `windows-exe` target):

```go
// Steps is the plan for one build, before it starts: core shows it as the
// build's pipeline. Optional (Planner).
func (b *builder) Steps(req protocol.BuildRequest) []protocol.BuildStep {
    var steps []protocol.BuildStep
    if id, _ := req.Values["icon"].(string); id != "" {
        steps = append(steps, stepIcon) // a step that will not run is left out
    }
    return append(steps, stepCompile, stepUpload)
}

func (b *builder) Build(ctx context.Context, job *factory.Job) (factory.Result, error) {
    var icon []byte
    if f, ok := job.File("icon"); ok {
        job.Step(stepIcon.ID, "fetching the icon")
        data, err := job.ReadFile(ctx, f) // size and SHA-256 checked
        if err != nil {
            return factory.Result{}, factory.Fail("icon_unreadable", err.Error())
        }
        icon = data
    }
    req := job.Request
    job.Step(stepCompile.ID, "compiling for "+req.Platform)
    // Core's minion config, baked in as it came: the minion reads it by number.
    bin, err := b.compile(ctx, req.Target, req.Platform, req.MinionConfig, icon, job.Log())
    switch {
    case err != nil && ctx.Err() == nil:
        return factory.Result{}, factory.Fail("compile_failed", "the minion did not compile; see the build log")
    case err != nil:
        return factory.Result{}, err // cancelled, out of time or stopping: the SDK says which
    }
    job.Step(stepUpload.ID, "")
    a := artifactKinds[req.Target] // the file's extension and media type
    if err := job.UploadArtifact(ctx, "minion-"+req.BuildID[:8]+a.ext, a.mediaType, bytes.NewReader(bin)); err != nil {
        return factory.Result{}, err
    }
    return factory.Result{}, nil
}
```

### Plans and steps

- **`Planner` is optional.** Its `Steps` is the plan core gets with the
  acceptance and shows as the build's
  [pipeline](../../contracts/minion-build/#the-pipeline): the steps the
  build goes through for these values, in order. It must be quick and
  valid (`protocol.ValidateBuildSteps`): 1 to 32 steps, each an `id`
  (`^[a-z0-9][a-z0-9_-]{0,62}$`, unique) and a `label` of 1 to 64
  characters on one line. An invalid plan, or a planner that panics, is
  logged and the build gets the default plan instead.
- **A builder that does not plan** has one step, `factory.DefaultStep`
  (`build`, "Build"). `factory.BuilderFunc` makes a builder of a function:

  ```go
  b := factory.BuilderFunc(func(ctx context.Context, job *factory.Job) (factory.Result, error) {
      job.Step(factory.DefaultStep.ID, "rendering")
      // …build, then job.UploadArtifact
  })
  ```

- **`job.Step(id, message)`** says the step the build is on, with an
  optional message for the operator ("compiling 3 of 10"). It never blocks:
  a newer report replaces one not sent yet, and a step outside the plan is
  dropped (and logged once). Core takes the steps before it as done.

### The job

| `*factory.Job` | |
|---|---|
| `Request`, `Target` | The `factory.build` request, already checked against the schema, and the target being built. `Values` holds every field with a value or a default. |
| `Steps()` | The plan, as core got it. |
| `HasCommand(id)` | Whether the minion is built with a command: the operator picked it, or the target requires it. Build in exactly the request's `commands`, or fail the build. |
| `Step(id, message)` | Report the step of the plan the build is on; the log's lines from then on are the step's. |
| `Log()`, `Logf` | The build log. factory-core sends it to core as it is written, line by line, each line with the step it was written in (before the first `Step`, the plan's first step's) and when ([`factory.build.log`](../../contracts/minion-build/#factorybuildlog)); the operators read it by step while the build runs. Its last 64 KiB also go with the result, for a core that does not take the live log. A line not ended yet goes when it ends, at the next `Step`, or when the build ends. |
| `File(key)` | The file a `file` field names: the field's value is its id, the file is in `Request.Files`. |
| `ReadFile`, `Download` | Fetch a file from core, into memory (small files) or to a path on disk, its size and SHA-256 checked; nothing is left at the path when it fails. |
| `UploadArtifact` | Spool the artifact to a temporary file, refuse one over the request's `max_size` (`artifact_too_large`), and upload it to core with its length; its size and SHA-256 go into the result. A second upload replaces the first. |

`Build` must return when `ctx` ends: the build was cancelled, ran out of
time, or the factory is stopping. Key material, secret values and files are
only for the build: never in the factory's logs, progress messages or the
build log, and never kept after it.

### The artifact

`job.UploadArtifact(ctx, filename, mediaType, body)` reads `body` to its
end into a temporary file, then `PUT`s it with its length to the request's
`artifact.upload_url`, a link on core, which streams it into its store.
The filename is a plain file name of 1 to 255 bytes, the one operators
download it as. An artifact over the request's `max_size` (core's
`BUILD_ARTIFACT_MAX_SIZE`, 256 MiB by default) fails the build with
`artifact_too_large` before anything is sent, and a build that returns
without an artifact fails with `no_artifact`. Core checks the stored
artifact's size and SHA-256 against the result before the build succeeds
([`factory.build.result`](../../contracts/minion-build/#factorybuildresult)).
The artifact holds the minion's keys: core gives it to operators alone,
always as an attachment.

### Results and failures

A build that returns no error after `UploadArtifact` succeeded. An error
fails it: `factory.Fail(code, message)` with a code of the factory's own
(`^[a-z0-9][a-z0-9_.-]{0,62}$`), and any other error as `build_failed`.
`factory.Result` carries up to 32 `Warnings`, shown with the build. The SDK
reports these codes itself:

| Code | When |
|---|---|
| `build_failed` | The builder returned an error without a code. |
| `no_artifact` | It returned without uploading an artifact. |
| `artifact_too_large` | The artifact is over the request's `max_size`. |
| `invalid_result` | The result broke the contract's limits; the message says how. |
| `timeout` | The deadline passed during the build. |
| `shutdown` | The factory stopped during the build. |
| `panic` | The builder panicked. |

The SDK takes care of the rest of the contract. It refuses a request that
does not fit the schema (`validation_failed`; `unsupported_version` for
another schema version) and builds over the limit or while draining
(`busy`). It answers a repeated request with the same plan without building
again, remembering a build for an hour past its deadline. It stops a build
when core cancels it or answers its progress with `not_found`. It sends the
result until core replies or the deadline passes: each attempt 10 s,
retries from 1 s doubling to 30 s.

## What core sends

The `factory.build` request ([the
contract](../../contracts/minion-build/#factorybuild)), checked by the SDK
before the builder sees it:

| Field | What it is | In the minion |
|---|---|---|
| `build_id` | The identity of the build and of the minion. | Yes: the minion's first message goes under it. |
| `crypto` | The suite and the minion's keys, fresh for each build. | Yes, and nowhere else. |
| `connections` | In the order the minion tries them: each one's settings as an endpoint export (`endpoint.params`, by the channel's field keys, defaults filled in), the factory's own `values` for it, its `failover`, and its `max_message`. | Yes. |
| `failover` | The build's failover policy, sent whatever the schema says. | For a schema that declares `failover`. |
| `commands` | The ids of the commands the minion is built with. | Yes, by their `op`s: these and no others. |
| `max_tasks`, `compression`, `session_id` | The minion's starting limit of tasks, the algorithm it packs with, the persisted session it claims: for a schema that declares `max_tasks`, `compression` (unless the operator turned it off), `persisted_sessions` (for a build with one). | Yes. |
| `envelope` | The target's envelope, present when it is not `cbor`. | Yes. |
| `values`, `files`, `credentials` | Every field with a value or a default; the files and credentials they name. | The factory's choice. A file's bytes are the factory's to handle. |
| `minion_config` | For a schema that declares `minion_config`: the settings above, numbered ([below](#the-minion-config)). | The factory's choice. |
| `artifact`, `deadline`, `actor` | Where the artifact goes and how large it may be, when core stops waiting, who built. | No. |

The operators' notes (a build's description, its connections' descriptions)
stay in core and never come in a request.

### Keys and settings in the artifact

Core makes a build's keys (for a suite of the factory's own, the factory
made them over its link); the factory writes them into the artifact and
keeps them nowhere else. For core's suite the material is two 32-byte keys,
base64 in the request's JSON:

```go
var keys protocol.AES256CBCHMACSHA256Material // EncKey, MACKey
if err := json.Unmarshal(job.Request.Crypto.Material, &keys); err != nil {
    return factory.Result{}, err
}
```

What else the minion needs comes from the same request: its connections in
order, each one's `max_message` (the minion keeps its messages within it),
the `op` of each command in `commands`, and `max_tasks`, `compression`,
`session_id` and `failover` where the schema declares them. How it goes in
(a config file compiled in, a script's constants, a patched binary) is the
factory's business. A factory that declares `minion_config` gets all of it
numbered, ready to bake in.

### The minion config

For a schema that declares `minion_config`, the request also carries the
[minion config](../../contracts/minion-build/#the-minion-config): the
request's settings as CBOR with numbered keys, base64 in the JSON. Core
makes it because only core holds every number it needs: the factory's own
(channels', fields' and connection parameters' `num`) and each channel's
for its fields. It holds the build id, the keys, the envelope, the
connections (channel, schema version, kind 1 to 4, the endpoint's settings
and the factory's parameters by number, failover, largest message), the
failover policy, the commands' `op`s, max tasks, compression, the persisted
session and the build's values; never a file, a link, the deadline or an
endpoint's name. The SDK checks it with the rest of the request: present
exactly when the schema declares it, readable, and this build's.

What goes into the minion stays the factory's decision. A minion in Go can
take the bytes whole: the factory writes them to a file before it compiles,
and the minion embeds the file (`//go:embed`) and reads it with
`protocol.ReadMinionConfig`, by numbers alone. Keep the numbers the minion
reads in one file and test them against the schema: a number, once given,
stays its field's.

## What the schema asks of the minions

Each declaration in the build schema is a promise about the minions the
factory builds. [Writing a Minion](../writing-a-minion/#what-a-minion-implements)
has the items in full.

| The schema declares | Core sends | The minion |
|---|---|---|
| `crypto` (core's suite) | `crypto`: the minion's keys | Seals and opens its messages with them, and stages or says `hello` under its build id ([Sessions](../../contracts/minion-messages/sessions/#staging)). |
| `crypto` or `envelope` of its own, with `codec` | The factory's own key material; `envelope` | Speaks the factory's format; the factory translates every message over its link ([Codecs](../../contracts/minion-messages/codecs/)). |
| `envelope: json` | `envelope: "json"` | Writes and reads core's [JSON envelope](../../contracts/minion-messages/codecs/#the-json-envelope). |
| `channels[].kinds` | Each connection's `kind` | Speaks that kind: checks in (`reverse-call`), keeps a connection core pushes over (`reverse-persistent`), answers core's calls, the first a `rehello` under its build id (`bind-call`), or listens for the channel's dial (`bind-persistent`). |
| `max_tasks` | `max_tasks`, 0 to 64 (5 unless the operator sets another) | Says its limit in its `hello`, takes core's `max_tasks` item and says the limit back, and asks for tasks within it ([Max tasks](../../contracts/minion-messages/tasks-and-results/#max-tasks)). |
| `compression` (`["deflate"]`) | `compression: "deflate"`, unless the operator turned it off | Inflates the `packed` items core sends; may pack its own ([Compression](../../contracts/minion-messages/wire-format/#compression)). |
| `persisted_sessions` | `session_id`, for a build with one | Claims the session in its `hello` (`sid`), and stops claiming on `session_replaced` ([Persisted sessions](../../contracts/minion-messages/sessions/#persisted-sessions)). |
| `failover` | `failover`, and each connection's own | Moves between its connections on its own as the policy says, with a `conn_update` each time ([Failover](../../contracts/channel-core-connections/#failover)). |
| `minion_config` | `minion_config` | Nothing on the wire. A minion built with the bytes reads them by number. |
| `error_codes` | Nothing | Exits with those codes when it cannot start ([Minion error codes](../../contracts/minion-build/#minion-error-codes)). |
| `error_codes_per_build` | `error_codes`: the build's exit codes, unless the operator turned them off | Exits with the build's codes instead of the declared ones, but for the fixed ones: the factory builds them in ([Codes per build](../../contracts/minion-build/#codes-per-build)). |
| A command with a `file` or `stream` param, or a file action | Tasks whose arg is a file offer | Moves files in `chunk`s with `ack`s ([File transfers](../../contracts/minion-messages/file-transfers/)). |
| A command with the `tunnel` or `reverse_tunnel` action (`opens`) | Tasks, then tunnel items | Opens, relays and closes streams (items 21 to 28: [Tunnels](../../contracts/minion-messages/tunnels/)). |
| A command with the `delegate` or `reverse_delegate` action (`serves`) | Tasks, then `delegate` items | Serves the channel kinds its command names for other minions ([Delegation](../../contracts/minion-messages/delegation/)). |
| A command's `result` | Nothing | Sends its task's data in the result's shape ([Task Results and Actions](../../contracts/task-results-and-actions/)). |

A build's own exit codes are `job.Request.ErrorCodes`, and
`job.Request.ExitCode(code)` gives the build's for a declared one (the
declared code itself when none was drawn). A field with `platforms`
([Fields for some platforms](../../contracts/minion-build/#fields-for-some-platforms))
comes in a request only for its platforms, and
`schema.PlatformFields(target, platform)` gives the fields a build takes.

## Testing a builder

`factorytest` runs a builder in process, without core or a broker, through
the same checks, plan, `Job` and result as `factory.Run`:

```go
st := factorytest.NewStore(t) // serves files and takes artifacts over HTTP
icon := st.File("icon-1", "app.ico", "image/x-icon", ico)
req := coreRequest(t) // below
req.Files = map[string]protocol.BuildFile{icon.ID: icon}
req.Values["icon"] = icon.ID
req.Artifact = protocol.ArtifactUpload{} // the store's, filled in by Run

out := factorytest.Run(t, buildSchema, &builder{}, st, req)
// out.Steps, out.Progress, out.Result: what core would have received.
// out.Artifact: the bytes uploaded (nil when the build failed).
```

`factorytest.Run` fills in what core adds when the request leaves it out (a
build id, the artifact's upload link and `max_size`, a deadline a minute
away) and fails the test when the request does not fit the schema, as the
factory would refuse it. `factorytest.Build` returns only the result and the
artifact. The store serves files and takes the artifact at absolute URLs: a
link that is a path on core's address does not work there.

### A request as core sends it

A builder is best tested with a request as core sends it: values with
their defaults filled in, the target's default and required commands,
connections as endpoint exports, keys, and, for a schema that declares it,
the minion config. One for the example schema, declaring `minion_config`
as well:

```go
func coreRequest(t *testing.T) protocol.BuildRequest {
    t.Helper()
    target, _ := buildSchema.Target("windows-exe")
    ch, _ := buildSchema.Channel("http")
    r := protocol.BuildRequest{
        BuildID: "5b0c4f6e-8a1d-4c2b-9e7f-3d2a1b0c9e8f", Target: "windows-exe", Platform: "windows/amd64",
        SchemaVersion: buildSchema.Version,
        // The values over the fields' defaults, as core sends them.
        Values: protocol.ResolveFieldValues(buildSchema.TargetFields(target), map[string]any{
            "kill_date": "2027-01-31T00:00:00Z", "guardrails": []any{"no_debugger"},
        }),
        // What a build that names no commands gets.
        Commands: buildSchema.DefaultCommands(target, "windows/amd64"),
        Connections: []protocol.BuildConnection{{
            Endpoint: protocol.ChannelEndpointExport{
                Format: protocol.ChannelEndpointExportV2, Name: "edge-eu", Kind: protocol.KindReverseCall,
                Channel: protocol.ExportChannel{ModuleName: "http", SchemaVersion: 3},
                Params:  map[string]any{"base_url": "https://edge-eu.example.com"},
            },
            Values: protocol.ResolveFieldValues(ch.KindFields(protocol.KindReverseCall),
                map[string]any{"path_prefix": "/cdn/assets/"}),
        }},
        Crypto: &protocol.BuildCrypto{
            Suite:    protocol.CryptoAES256CBCHMACSHA256,
            Material: json.RawMessage(`{"enc_key":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=","mac_key":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI="}`),
        },
        Deadline: time.Now().Add(time.Minute),
    }
    // The minion config core would make of it (the schema declares minion_config).
    cfg, err := protocol.EncodeMinionConfig(buildSchema, r, testChannels)
    if err != nil {
        t.Fatal(err)
    }
    r.MinionConfig = cfg
    return r
}
```

`EncodeMinionConfig` numbers the endpoint's settings by the channel's own
field numbers, which a factory does not have: it takes them from a function
that gives each channel's connection schema at a version
(`protocol.ConnectionSchemaAt`). In a test, `testChannels` gives the
schemas of the channels the factory lists, at the versions it lists, each
field's key, `num`, type and default as the channel declares it (the
channel's page in the web app shows its schema, each field with its
number). With the config in the request, a test can read it back as the
minion will (`protocol.ReadMinionConfig`) and check each number.

### A request core sent

A build's **JSON** tab in the web app has **Sent to factory**: the
`factory.build` request core sent, exactly as it went, and **Download**,
which saves it as `<build id>.factory-build.json`. It is a real request to
build against away from core. It holds the minion's keys, as the artifact
does. To run it through `factorytest`:

- decode it into a `protocol.BuildRequest`;
- clear `Artifact` and `Deadline`: Run fills them in (the request's are a
  path on core's address and a time already past);
- replace each of `Files` with the same file from a `factorytest.Store`
  (`st.File` with the file's id, name, media type and bytes);
- keep `build_id` and `minion_config`: the SDK checks that the config is
  this build's.

## Running against a dev core

Core's dev stack ([`logos-core`](https://github.com/LogosCore/logos-core),
`make services`) runs on the Docker network `logos-core_logos`: core as
`logos-core-dev` (port 8002), RabbitMQ as `logos-rabbitmq`, and core's
front, `logos-nginx`, on the host's ports 8080 (HTTP) and 8443 (HTTPS, a
self-signed certificate).

1. **Run the factory** on that network (its `docker-compose.yml` joins
   `logos-core_logos` as an external network):
   `LOGOS_CORE_BASE_URL=http://logos-core-dev:8002`,
   `RABBITMQ_HOST=logos-rabbitmq`, and RabbitMQ's user and password from
   core's `.env` (`RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`). On the
   host instead, RabbitMQ is on `localhost:5672` and core is reached through
   its front, `http://localhost:8080`.
2. **Give it an instance id of its own.** Core keys registrations by
   instance id alone: two modules under one id replace each other, whatever
   their type.
3. **Check it registered.** Its log says `control plane: registered with
   core`; a schema core refuses says `control plane: rejected by core`, with
   `op` `module.register` and the reason. In the web app, **Modules** lists
   the instance; the factory's page shows its targets, build parameters and
   commands, each with its number, and its minion error codes.
4. **Build.** Start a channel the factory lists too. **Builds → New
   build**: a target and platform, commands, values, and a connection
   through the channel (for a minion run on the host, the address the
   channel listens on there). The build's
   **Pipeline** shows the factory's plan and the step it is on; a failure
   shows its code and the build log; **JSON → Sent to factory** shows the
   request.
5. **Run the artifact.** The build's **Download** saves it; run it where it
   reaches the channel. Its session appears under **Sessions**;
   give it a task from the session's console. [Writing a
   Minion](../writing-a-minion/#when-it-does-not-work) has what to look at
   when it does not show.

## Checklist

1. **One instance id per process**, and a fixed `module_name` for the kind.
2. **A valid schema**, checked in a test with `protocol.ValidateBuildSchema`.
   Every channel, field (`file` fields too) and connection parameter has a
   `num`, every command an `op` and each of its params a `num`; once given,
   a number stays its field's or command's. A field or target removed,
   renamed or given another meaning raises `version`; a command retired or
   renamed stays, marked [`legacy`](../../contracts/minion-build/#legacy-commands),
   beside its successor's new `id` and `op`.
3. **`CoreURL` set** (`LOGOS_CORE_BASE_URL`), and core's TLS settings where
   core has a certificate nobody trusts.
4. **A plan that follows the request**: the steps that will run, nothing
   more.
5. **The request's commands, exactly.** Build in every command in
   `commands` and no other, or fail the build.
6. **The keys and settings into the artifact**: `build_id`, the keys, the
   connections in order with their `max_message`, the commands' `op`s, and
   `max_tasks`, `compression`, `session_id` and `failover` where the schema
   declares them.
7. **Nothing secret outside the artifact**: no key, secret value or file in
   logs, progress messages or the build log, and nothing kept after the
   build.
8. **`Build` returns when `ctx` ends.** Long work (a compiler) runs under
   the build's context.
9. **Failures with codes of the factory's own** (`factory.Fail`), so an
   operator can tell them apart.
10. **Promises the minions keep.** Each declaration in [the
    table](#what-the-schema-asks-of-the-minions) is one.
11. **Tests with a request as core sends it**: values with defaults, keys,
    connections, and the minion config.
12. **A `Codec`** when the schema names a suite or an envelope of the
    factory's own.
