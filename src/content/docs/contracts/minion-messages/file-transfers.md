---
title: "File Transfers"
---

Files move between a minion and core in **chunks**, in either direction, for
a task. A file is either **kept** by core (up to a size limit) or **streamed**
through it (any size, nothing kept). Four flows, all made of the same `chunk`
and `ack` items:

| Flow | Direction | The task's action | Core keeps it | Who sets the pace |
|---|---|---|---|---|
| [A minion sending a file](#a-minion-sending-a-file) | minion → core | [`download_file`](../../task-results-and-actions/#download_file) | yes, in its minion files bucket | the minion, acked by core |
| [Core sending a file](#core-sending-a-file) | core → minion | [`upload_file`](../../task-results-and-actions/#upload_file) | it was kept already (a task file) | the minion, pulling |
| [Streaming a file](#streaming-a-file) | minion → core → a downloader | [`stream_file`](../../task-results-and-actions/#stream_file) | no | the downloader |
| [Streaming a file to a minion](#streaming-a-file-to-a-minion) | an uploader → core → minion | [`upload_stream`](../../task-results-and-actions/#upload_stream) | no | the uploader and the minion |

How operators start and watch each flow in the web app (Download, Upload
here, the stream's link and curl command) is in [Task Results and
Actions](../../task-results-and-actions/).

## Chunks

```cddl
chunk = {
  0: 12,                ; t: chunk
  1: xfer-id,           ; xfer: the transfer, 16 random bytes
  2: uint,              ; off: where data starts in the whole
  3: bstr,              ; data: at most 512 KiB
  ? 4: uint,            ; total: the whole's size, in the first chunk (off 0)
  ? 5: bstr .size 32,   ; sha256: of the whole, in the last chunk
  ? 6: task-id,         ; task: the task the transfer belongs to, in the
                        ;   first chunk
  ? 7: tstr,            ; name: the file's name, or its path on the host,
                        ;   in the first chunk
}
```

The receiver answers with an [`ack`](../tasks-and-results/#acknowledging)
naming the transfer:

| `ack` field | Means |
|---|---|
| `xfer` with `next` | the receiver has every byte before `next`: go on from there |
| `hold` (with `xfer`) | the transfer waits: send (or, pulling, ask for) nothing more until an ack without `hold` |

These rules hold for every flow:

- **In order only.** The receiver keeps a chunk only when it starts where it
  has the file (`off` = its `next`); one sent again, or out of order, is not
  kept twice, and the ack says where to go on from. A lost message costs a
  chunk sent again, nothing more.
- **Resumable.** The sender always continues from the receiver's `next`, so a
  transfer resumes after a restart of either side.
- **Checked.** The last chunk (`off` + its size = `total`) carries `sha256`
  of the whole, which the receiver checks.
- **Ended with its task.** A task that ends, stopped or failed, while its
  file moves ends the transfer; what was received is dropped.

## A minion sending a file

A file core asked for, kept in core (a `download_file` task):

1. The minion picks the transfer's `xfer` and sends the first chunk, `off` 0,
   with `total`, `task` and `name` (the file's path on its host). It sends
   the next chunk in each message, from where core's last ack said, and
   checks in again **at once** while it has a chunk to send.
2. Core keeps each chunk in order and acks the new `next`.
3. With the last chunk (and its `sha256`), core joins the file and checks its
   size and SHA-256, in the background: the file is kept, or failed with
   why. The minion ends the task with the
   [`file_download`](../../task-results-and-actions/#file_download) data once
   core has every byte.

Core refuses a chunk with an `err` naming it, and the minion ends the task
failed with the reason:

| `code` | When |
|---|---|
| `unknown_task` | a first chunk naming no task of the session |
| `bad_message` | a task whose command sends no file (no result `file_download`), a chunk past `total`, a last chunk without `sha256`, or a transfer that ended |
| `too_large` | a file over core's limit (`MINION_FILE_MAX_SIZE`, 2 GiB by default) |

A transfer with no chunk for a day is given up, its chunks dropped.

## Core sending a file

A file an operator uploaded to core for the task (a **task file**), sent to
the minion (an `upload_file` task). Core cannot start an exchange through a
channel, so the minion **pulls** it: each ack asks for the next chunk, and
core's reply brings it.

1. The task names the file in an arg of type `file`, a
   [`file-offer`](../tasks-and-results/#tasks): `{xfer, name, size, sha256}`. Core picks `xfer` per task, so the same file sent to two tasks is
   two transfers. `name` is the file's name as uploaded (no path); `size` and
   `sha256` are the whole's.
2. The minion gets ready to write (it checks the destination, opens a
   temporary file next to it), then asks for the first chunk:
   `ack {xfer, next: 0}`. A minion that cannot write the file ends the task
   failed without asking, and nothing is sent.
3. Core answers each ack with the chunk from `next` (the first with `total`
   and `task`, the last with `sha256`), in the room its reply has left once
   its other items are in; with too little room it sends none, and the
   minion asks again. The minion writes the chunk and asks again **at once**.
   Its ack is also how far it has the file: core shows that as the task's
   progress.
4. With every byte written, the minion says so with one more ack (`next` the
   file's size: core sends nothing for it, and the progress reads whole),
   checks the size and SHA-256 against the arg's, moves the temporary file
   into place, and ends the task with the
   [`file_upload`](../../task-results-and-actions/#file_upload) data. A file
   that does not check out ends the task failed, its temporary file removed.

A chunk that came twice is written once (the minion keeps its own `next`).
Core answers an ack it cannot serve with an `err`, and the minion ends the
task failed:

| `code` | When |
|---|---|
| `unknown_task` | a transfer no task of the session has, or whose task ended (but an ack saying the minion has the whole file, which may come with the task's end) |
| `bad_message` | a `next` past the file's size, or a file core no longer has |

## Streaming a file

A file of any size, sent straight to whoever downloads it, with nothing kept
in core (a `stream_file` task). It is [a minion sending a
file](#a-minion-sending-a-file) with two differences: the minion first
announces the file without data, and core's acks may say `hold`. Core acks a
chunk when its downloader has room for it, so the downloader sets the pace;
it acks `next` where the downloader wants the bytes from, so a download
resumed from any offset is the minion reading from there again.

1. The minion opens the file and sends a first chunk with no `data`: `off` 0,
   `total`, `task` and `name`. Core answers `ack {xfer, next: 0, hold: true}`:
   the stream waits for a downloader.
2. While held, the minion sends nothing of the transfer. It checks in on its
   own schedule until the stream first runs; after that, about every second,
   so a paused download starts again quickly.
3. A downloader attaches (`GET /api/v1/minion-streams/{task}`, with a `Range`
   to resume). At the minion's next check-in core answers `ack {xfer, next}`
   without `hold`, `next` where the downloader wants the bytes from. The
   minion sends the chunk from `next`, at once and again with each ack; an
   ack may set `next` back (a download resumed from earlier), and the minion
   reads from there. Its chunk from 0 says `total`, `task` and `name` again,
   as any first chunk does.
4. Core passes each chunk to the downloader through a small buffer (a few
   chunks, shared by core's instances). When the buffer is full, or the
   downloader goes away, core acks with `hold`.
5. The last chunk carries `sha256` when the minion read the whole file in
   order once; a stream resumed from the middle may end without it. When the
   downloader has every byte, core acks `next` = `total`, and the minion ends
   the task with the [`file_stream`](../../task-results-and-actions/#file_stream)
   data.

A stream ends when its task does: stopped by an operator (core sends no more
acks, cuts the download, and the minion closes the file), or after **an hour
with no downloader**, when core cancels the task. A file that grows while
streamed is sent as far as the size announced; one that shrinks fails the
task.

## Streaming a file to a minion

A file of any size, sent to the minion as its uploader sends it to core, with
nothing kept in core (an `upload_stream` task). It is [core sending a
file](#core-sending-a-file), the minion pulling it, with three differences:

1. The task's `stream` arg is `{xfer, name, stream: true}`: core knows neither
   the size nor the SHA-256 when the task goes out. The first chunk says
   `total`, which core learns from its uploader.
2. Core passes the uploader's bytes through a small buffer (a few chunks,
   shared by core's instances). It answers each ask with the chunk from
   `next` when the buffer has it, and drops the chunks before `next`. With
   nothing to send yet (no uploader, or the uploader behind), it answers
   `ack {xfer, next, hold: true}`, and the minion asks no more until an ack
   without `hold`: before the first chunk, on its own schedule; after, about
   every second. Every reply carries the stream's ack, so the minion hears
   when bytes are there.
3. The last chunk says `sha256` of the bytes core passed on, hashed in order
   as they went. The minion checks it, as it checks a file core sends, and
   ends the task with the
   [`file_upload`](../../task-results-and-actions/#file_upload) data.

A stream ends when its task does: stopped by an operator, or after **an hour
with no uploader**, when core cancels the task. Its uploader then gets an
error, and the minion removes its temporary file.

## What core keeps

- **Kept files** (a minion's downloads, and task files for uploads) live in
  core's **minion files bucket** (`MINION_FILE_BUCKET`, `minion-files`),
  apart from the wiki's and the builds'. While a minion's file comes, core
  keeps each chunk as an object of its own, so any core instance takes the
  next one, and joins them at the end. Files stay until their operation is
  deleted.
- Once a file is joined, core reads its **type** from its first bytes. Any
  member of the operation can download it from
  `GET /api/v1/minion-files/{id}`, which answers byte ranges and names it as
  the host did. It comes as an attachment; with `?preview=1` it comes inline,
  but only for the types the wiki shows inline (PDF, plain text, pictures,
  audio and video), with a sandbox CSP and `nosniff`, so nothing in it runs.
  The `minionFileStrings` query reads its printable strings (ASCII and
  UTF-16LE), a page at a time.
- **Streams** pass through a few chunks at a time, buffered where every core
  instance sees them, and nothing stays when they end. Their links are
  signed and last a day at most.

| | |
|---|---|
| A chunk's data | 512 KiB |
| A kept file | 2 GiB by default (`MINION_FILE_MAX_SIZE`, at most 64 GiB) |
| A streamed file | no limit |
| A minion's file with no chunk | given up after a day |
| A stream with no downloader or uploader | cancelled after an hour |
