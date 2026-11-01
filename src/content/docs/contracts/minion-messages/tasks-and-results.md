---
title: "Tasks and Results"
---

Operators give a session's minion **tasks** from its console in the Sessions
page; the minion runs them and sends back **results**. This page covers how
an exchange goes, how a minion asks for tasks, a task and its arguments,
acknowledging and cancelling, results, and listings of the host's file
system. What a result's `data` means, command by command, is in [Task Results
and Actions](../../task-results-and-actions/).

## How an exchange goes

Through a channel, the minion starts every exchange:

- **The minion checks in.** It sends a message every check-in interval
  (`checkin_interval` with `checkin_jitter`, from its connection), or sooner
  when it has something to send. Core answers.
- **Core answers every message that carries items** with a sealed reply whose
  `re` is the request's `id`, even when it has nothing of its own. Only an
  empty check-in, when core has nothing either, gets **204**.
- **Items count as delivered only on a sealed reply with the matching `re`.**
  On a 404, a timeout, or a 204 to a message with items, the minion sends
  them again in a later message, under a new `id`.
- **Every item can be sent again safely.** Results are taken once by
  `(task, seq)`, chunks by `(xfer, off)`; acks and hellos are the same each
  time. So nothing needs exactly-once delivery: both sides resend until the
  other confirms.

## Asking for tasks

How many tasks a minion runs at once is its build's business, so the minion
asks:

```cddl
get_tasks = {
  0: 7,                 ; t: get_tasks
  ? 1: uint,            ; max: at most this many; absent, no limit of the
                        ;   minion's. 0 is invalid.
}
```

- **Core puts tasks in a reply only when the request has a `get_tasks`**, and
  never more than `max`. A minion that is busy leaves it out and gets no new
  task, whatever else its request carries.
- **`get_tasks` can share a request** with results, acks, chunks or a
  `hello`: a minion that finishes a task sends its result and takes the next
  task in one round trip.
- **`max` absent** means no limit of the minion's: core sends what it has
  within one message's [limits](../wire-format/#limits), and the rest in
  later replies. A minion that wants nothing leaves `get_tasks` out.
- **Tasks sent before and not acked come first**, and count toward `max`: a
  minion whose reply with tasks was lost gets them again on its next
  `get_tasks`.
- **Only tasks wait for `get_tasks`.** `cancel`, acks, chunks,
  `stage_response` and `hello_response` come whenever core has them, so a
  minion busy with a long task can still be told to stop it.
- **One `get_tasks` per request.** A second is a `bad_message`.
- *Planned, with the [connection kinds](../../channel-core-connections/#get_tasks-on-a-persistent-connection)*:
  on a persistent connection `get_tasks` becomes a standing allowance of
  unfinished tasks, and `max 0` (taking none for now) becomes valid.

## Tasks

```cddl
task = {
  0: 8,                 ; t: task
  1: task-id,           ; task
  2: uint,              ; cmd: the command's op in the build schema
  ? 3: { * uint => arg },  ; args: by their params' num in the build schema
}

file-offer = {          ; a file or stream param's arg
  1: xfer-id,           ; xfer: the transfer, core's pick, one a task
  2: tstr,              ; name: the file's name as uploaded, no path
  ? 3: uint,            ; size: the whole's (not a stream's)
  ? 4: bstr .size 32,   ; sha256: the whole's (not a stream's)
  ? 5: true,            ; stream: the file is streamed to the minion
}
```

A task names its command by its **`op`** and each arg by its param's
**`num`**, the numbers the build schema gives them
([Commands](../../minion-build/#commands)): a minion dispatches on numbers
its factory compiled in, and carries no command or param names. Operators,
core and the API name commands and params by `id` and `key` as before; core
puts the numbers in when it sends the task. Core fills in defaults and checks
the args before the task is queued, so a minion gets every arg that has a
value or a default. Their types map to CBOR like this:

| Param type | CBOR |
|---|---|
| `string`, `url`, `secret`, `enum` | text |
| `int`, `bytes` | integer (`bytes`: a byte count) |
| `number` | float |
| `bool` | `true` / `false` |
| `duration` | unsigned integer, milliseconds |
| `datetime` | integer, unix seconds |
| `string_list`, `enum_list` | array of text |
| `string_map` | map of text to text |
| `file` | `file-offer`: the [file core sends](../file-transfers/#core-sending-a-file) for the task, `{xfer, name, size, sha256}` |
| `stream` | `file-offer`: the [file core streams](../file-transfers/#streaming-a-file-to-a-minion) for the task, `{xfer, name, stream: true}` |

- **Core sends a task again**, when asked, until the minion acks it or a
  result for it arrives.
- **The minion runs each task once**: it keeps the ids of the tasks it
  received in the last 24 hours.
- **A task the minion cannot run** (a command its build lacks, an `op` it
  does not know, an arg of the wrong type) gets a `result` `{done: true, ok:
  false, err: …}`.
- `help` is core's own command: core answers it at once and it never goes
  out ([Commands](../../minion-build/#commands)).

## Acknowledging

```cddl
ack = {
  0: 11,                ; t: ack
  ? 1: [* task-id],     ; tasks: tasks received
  ? 2: xfer-id,         ; xfer, with next: the receiver has every byte of
  ? 3: uint,            ;   the transfer before next
  ? 4: bool,            ; hold, with xfer: the transfer waits (see File
                        ;   transfers)
}
```

A minion acks the tasks it received with `tasks`, in its next message: core
stops sending them. `xfer`, `next` and `hold` move a file transfer along
([File transfers](../file-transfers/#chunks)).

## Cancelling a task

```cddl
cancel = { 0: 9, 1: task-id }   ; t: cancel, task
```

When an operator stops a task, core sends `cancel` with **every reply** until
the task ends; a task not sent yet is cancelled in core at once and never
goes out. The minion stops the task and still sends a final `result`
(`done`). A `cancel` for a task the minion does not have gets an `err`
`unknown_task`.

## Results

```cddl
result = {
  0: 10,                ; t: result
  1: task-id,           ; task
  2: uint,              ; seq: 0, 1, 2, …, the parts of one task's output
  ? 3: bool,            ; done: the last part; ok is then required
  ? 4: bool,            ; ok: the minion did what the task asked
  ? 5: bstr,            ; out: output as raw bytes, in the host's own encoding
  ? 6: tstr,            ; err: what went wrong, with ok: false
  ? 7: { * any => any },  ; data: structured output, its command's
                        ;   result's shape: numbered for core's results
  ? 8: int,             ; exit: the exit code of a process the task ran,
                        ;   done part only
  ? 9: [* listing-piece],  ; ls: what the task saw of the file system,
                        ;   Listings
}
```

A task's output comes in **parts**, `seq` 0, 1, 2, …, the last with `done`. A
long task streams them as it goes; a short one may send one part. A part can
carry what a person reads (`out`), what a program reads (`data`), listings
(`ls`), or several of these.

- **`out`** is the output as raw bytes, as the command produced it: no
  conversion, so a host's code page (866 on a Russian Windows, 850 or 1252 on
  others) and binary output pass unchanged. stdout and stderr may be mixed in
  it. Core and the web app decode it by guesswork, and offer the bytes as a
  download where they do not decode. The parts' `out` join in `seq` order.
- **`data`** is structured output, such as a walk's progress or a process
  list, in the shape of its command's [result](../../task-results-and-actions/)
  (named in the build schema). The data of core's results travels numbered,
  and core names it as it takes the part; a factory's own shape (a command
  without a result) keeps its text keys. Core checks each part, keeps it as
  CBOR, and joins the parts by the result's rule. Output too big for one
  message goes in several parts.
- **`ok`** says whether the minion did what the task asked. **`exit`** is what
  a process the task ran reported, so a program that exits with 1 is still
  `ok: true`, and a command the minion could not start is `ok: false` without
  `exit`. Only commands that start a process have one (`shell`); those the
  minion carries out itself (`ls`, `download`) do not. A process killed by a
  signal has no exit code: the minion says so in `err`.

How core keeps a task's parts (the done part is the last, a late part fills a
gap, output and data share 4 MiB, missing parts are flagged) is in [What core
does with a result](../../task-results-and-actions/#what-core-does-with-a-result).
Operators read a task's output and data in its console; the bytes as they came
download from `GET /api/v1/minion-tasks/{id}/output`, and the data as a CBOR
sequence from `GET /api/v1/minion-tasks/{id}/data`.

## Listings

What a task saw of the host's file system travels as **listings**, on its
result parts (`ls`), beside or instead of `out` and `data`: a directory's
entries, read by any command (an `ls` of one folder, a walk over many). Core
keeps them in the machine's [file browser](../../file-browser/) as they come.

```cddl
listing-piece = {
  1: uint,              ; id: which listing of the task, 0, 1, 2…
  2: uint,              ; part: which piece of it, 0, 1, 2…
  ? 3: bool,            ; last: the listing's last piece
  ? 4: tstr,            ; path: the directory, absolute, as the host
                        ;   writes it
  ? 5: "/" / "\\",      ; sep: the host's separator
  ? 6: tstr,            ; parent: the directory above, left out at a root
                        ;   (path, sep, parent: part 0 only, which needs
                        ;   path and sep)
  ? 7: [* entry],       ; entries
  ? 8: bool,            ; partial: some entries could not be read, not the
                        ;   whole
  ? 9: uint,            ; err: the directory could not be read at all
                        ;   (denied 1, not found 2, other 3): part 0, last,
                        ;   no entries
  ? 10: [* tstr],       ; owners: the owner and group names its entries
                        ;   name, each once
  ? 11: tstr,           ; err_msg: more on err, for a person
}

entry = {
  1: tstr,              ; name
  2: uint,              ; type: dir 1, file 2, link 3, other 4
  ? 3: uint,            ; size
  ? 4: int,             ; modified: unix seconds
  ? 5: uint,            ; mode: the host's own bits, st_mode (Unix) or the
                        ;   file attributes (Windows)
  ? 6: uint,            ; owner: its place in the piece's owners, from 1
  ? 7: uint,            ; group: its place in the piece's owners, from 1
  ? 8: tstr,            ; target: a link's
  ? 9: bool,            ; hidden
  ? 10: { * tstr => any },  ; x: the factory's own fields, text keys
}
```

```mermaid
flowchart LR
    T[A task's result parts] -- "ls: pieces" --> C[Core]
    C -- each piece, as it comes --> S[(The machine's file browser)]
    C -- "a dir_listing command: its first listing" --> D[The task's data]
```

- **A listing is one directory**, numbered `id` within its task. An `ls`
  sends one; a walk sends one a folder.
- **It comes in pieces**, numbered `part` from 0, the last with `last`. The
  first names the directory; every piece adds entries. One result part can
  carry pieces of several listings, and one listing can span several parts.
- **Whole** is a listing whose pieces 0 to `last` all came and none says
  `partial`. Only a whole listing tells core what the folder no longer has;
  one cut short adds what it has.
- **`err`** is a directory the minion could not read: one piece, `part` 0
  and `last`, no entries, the reason as a code (permission denied, not
  found, other) with `err_msg` for more. Core marks the folder so, by the
  code's name.
- **Entries as the host has them.** An entry's `mode` is the host's bits, not
  their rendering, and its `owner` and `group` are places in the piece's
  `owners`, so names that recur (every file `root`) travel once a piece. Core
  names it all as it takes the piece: the type by name, the mode as the host
  shows it (`-rw-r--r--` as `ls -l` does, or on Windows `-a-h--` as
  PowerShell does, by the session's `os`), the owners by name.

Core, as each result part comes:

1. **Takes its pieces into the file browser at once**, not when the task
   ends: a long walk fills the browser as it goes, and a stopped one keeps
   what it saw. A listing's time is when core took its first piece (not the
   minion's clock); every piece of it shares it. A piece that comes before
   its listing's first (a part resent late) waits for it.
2. **Keeps them apart from the task's output and data**: listings do not
   count toward its 4 MiB.
3. **Makes a [`dir_listing`](../../task-results-and-actions/#dir_listing)
   command's data from its first listing** (`id` 0), so its task shows what
   it read as any task's data.

## Open questions

- **Unsolicited data.** Output that belongs to no task (a minion-side
  monitor) would need an `event` item.
