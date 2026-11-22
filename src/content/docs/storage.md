---
title: "Storage"
---

Core keeps its files in an S3 object store, SeaweedFS ([Core
Infrastructure](../core-infrastructure/#seaweedfs--blob-storage)): what
minions send, recordings, builds, the wiki's attachments, skills. The
**Storage** page shows admins what the store holds and what would stop it
taking writes, and runs its maintenance. Core reads the store once a minute:
SeaweedFS's master, when core is set to reach it, and core's own records of
what it keeps in each bucket. It also runs the retention cleanups of
recordings ([below](#retention-cleanups)).

| Who | Can |
|---|---|
| `storage:read` (the admin role) | See the page, the retention policy, and the sidebar's count of its warnings |
| `storage:manage` (the admin role) | Run its maintenance, preview and run cleanups, and set the retention policy. An agent key never does. |

## Where core keeps its files

A bucket is a SeaweedFS collection of the same name. Each kind of record core
keeps has a bucket of its own, named by a setting. The settings can name one
bucket for several purposes. The page sums each bucket's records by operation
and kind:

| Setting (default bucket) | Core keeps | Kinds |
|---|---|---|
| `MINION_FILE_BUCKET` (`minion-files`) | The files minions send, and the files operators upload for tasks | Task uploads, Screenshots, Downloads (a minion's file, or a stream core kept as it passed) |
| `DESKTOP_RECORDING_BUCKET` (`desktop-recordings`) | The desktops' and the terminals' recordings: a video once converted, else its parts; none of those a cleanup took | Desktops, Terminals |
| `BUILD_BUCKET` (`logos-builds`) | The files uploaded for builds, and their artifacts until deleted | Build files, Artifacts |
| `WIKI_IMAGE_BUCKET` (`wiki-images`) | The wiki's images not deleted | Images |
| `WIKI_FILE_BUCKET` (`wiki-files`) | The wiki's other attachments not deleted | Files |
| `SKILL_BUCKET` (`skills`) | Every version of every skill, no operation's | Skill versions |

A minion file counts once kept, or while it comes with its bytes so far. One
that failed or was stopped holds nothing: its chunks were dropped. Volumes
written outside any bucket are SeaweedFS's own files. A bucket core does not
name, a test's say, shows as not core's.

## The page

Four tabs:

- **Overview.** The store's warnings ([below](#warnings)), then three kinds
  of card:
  - **SeaweedFS:** whether core reaches its master, its version, and its
    volume slots (free, of all). It also shows when core read the store.
  - **Disk**, one per volume server: used and free, the store's part of it
    (every bucket's volumes), and the server's volumes.
  - **A card per bucket:** what core keeps there by its records (objects
    and their bytes), its bytes on disk with the part deleted files still
    hold, and its volumes: writable, and full or read-only.
- **What core keeps:** a bucket's records by operation and kind, the
  largest first, a page at a time, searched by the operation's name or the
  kind.
- **Retention:** the retention policy, a cleanup now at an age, and what it
  would take by operation ([below](#retention-cleanups)).
- **Activity:** the maintenance and the cleanups run: what, by whom, when,
  how it went, or where a running one is. Each one's details show it as it
  goes (a reclaim's every volume), and Stop ends a running reclaim or
  cleanup ([Maintenance](#maintenance)).

The same is in the GraphQL API: `storageStatus`, `storageConsumers`,
`storageActions`, `storageAction` and `storageRetention` to read,
`storageCleanupPreview` to preview a cleanup, and `reclaimStorage`,
`growStorageBucket`, `cleanUpStorage`, `setStorageRetention` and
`cancelStorageAction` to act.

### Warnings

What the page warns of, the worst first. The sidebar's Storage entry counts
the errors and warnings.

| Level | When | What to do |
|---|---|---|
| Error | No volume slot is free: a bucket that needs a new volume fails its writes | Free disk on the volume servers: about one slot a GB ([Core Infrastructure](../core-infrastructure/#seaweedfs--blob-storage)) |
| Warning | Fewer than 3 slots are free | The same, before they run out |
| Error | A bucket has no writable volume and no slot is free: its writes fail. Or a bucket of core's has no volume yet and no slot is free: its first write fails | Free disk, then add a volume |
| Warning | A bucket has no writable volume, with slots free: SeaweedFS adds one at its next write | Add a volume, or let the next write do it |
| Warning | A volume server's disk has less than 10% free | Free disk there |
| Info | Deleted files hold 30% of a bucket's bytes on disk, and at least 64 MiB | Reclaim space |
| Error | Core cannot reach SeaweedFS's master | Check the master, and `SEAWEEDFS_MASTER_URL` |
| Warning | Core cannot read its records, or a volume server's disks | Check MongoDB, or the volume server |

## Maintenance

Each action asks to be confirmed, and Activity keeps it: who ran it, when,
how it went. One reclaim runs at a time, and one Add a volume for a bucket.
A reclaim and a cleanup run for as long as they take, each keeping its
progress as it goes. An admin stops one (Stop, `storage:manage`): it stops
before its next step, what it did kept, and ends cancelled, saying who
asked. A core that stops while one runs marks it failed, saying so.

- **Reclaim space.** Core compacts, one at a time, every volume of every
  bucket whose deleted files hold a tenth of it or more, the most deleted
  first: their space comes back to the disk. It goes through SeaweedFS's
  master over gRPC, volume by volume, and pauses SeaweedFS's own vacuum
  meanwhile: the master runs one vacuum at a time. It resumes it as it ends,
  or as core starts again after a core that stopped first.

  Core reads each volume on its volume server before and after, and keeps
  how it went:
  - compacted, with the bytes it freed;
  - skipped, with why: it is read-only, or by then deleted files hold less
    than a tenth of it;
  - failed, with why: the master did not compact it, asked 3 times (or, for
    the first volume, over five minutes, while SeaweedFS's own vacuum ends
    the volume it was on).

  The details list each volume, and the step under way. Stop ends the
  reclaim before its next volume: SeaweedFS ends the one under way. A volume
  answers slower while it is compacted. SeaweedFS also compacts on its own,
  past 30%.
- **Add a volume.** SeaweedFS gives a bucket a writable volume, which takes
  one free slot: a bucket with no writable volume gets one again, or room
  before much is written to it. It works on a bucket of core's or one
  SeaweedFS has, never on SeaweedFS's own files. With no free slot it fails,
  with SeaweedFS's reason.

Not on the page:

- **Deleting empty volumes.** A volume nothing was ever written to still
  takes a slot. SeaweedFS's shell drops them: in the master's container, run
  `weed shell`, then `lock`, `volume.deleteEmpty -quietFor=24h` (a dry run),
  the same with `-apply`, and `unlock`.
- **Deleting a bucket.** A bucket core does not own, a test's say, is left
  as it is.

## Configuration

| Setting | |
|---|---|
| `SEAWEEDFS_MASTER_URL` | SeaweedFS's master. The Compose file gives core-dev `http://seaweedfs-master:9333`. The Helm chart sets it for the SeaweedFS it bundles, and to `external.seaweedfs.masterUrl` for one of your own. Empty, the page shows what core's records say alone, and runs no maintenance. |
| `SEAWEEDFS_MASTER_GRPC` | The master's gRPC address (`host:port`), which a reclaim compacts volumes through. Empty, the master URL's host on its port plus 10000 (SeaweedFS's own default: `seaweedfs-master:19333`). The Helm chart sets it to the bundled master's gRPC port, and to `external.seaweedfs.masterGrpc` for one of your own. |

The master's APIs, HTTP and gRPC, take no credentials: whoever reaches them
can delete a bucket's volumes. Keep them on core's network alone. The
Compose file publishes only the S3 port.

## Retention cleanups

Space comes back to the disk only once core deletes what it keeps. Besides
the cleanups, that happens when:

- an operator deletes a recording, a build's artifact bytes, or a build;
- an operation is deleted, with everything core kept for it;
- core drops a task upload no task needs, and a build upload nothing refers
  to;
- the wiki's sweepers, when on (`WIKI_SWEEPER_ENABLED`), delete attachments
  no document refers to.

Minion files and artifacts stay until their operation is deleted: no
cleanup takes them. Cleanups are for **recordings** alone, the desktops'
and the terminals', which grow with every one operators open.

### What a cleanup takes

A cleanup has an age, in days (1 to 3,650; the page offers 30), and covers
every operation or one. It takes the recordings that ended at least that
long ago and hold something, but not:

- those of a task marked important (the star an operator puts on a task in
  a session's console), for as long as the mark stays;
- one still recording, or one that did not open;
- one being made a video, while the encoder holds it.

A recording taken loses its files, its parts or its video and keys. Its
record stays, marked cleaned up, with when and by which cleanup: its task's
Recordings tab still lists it, as cleaned up. It no longer plays or
downloads, and its file answers 410. What core keeps no longer counts it.
Nothing is kept elsewhere first.

### Running one

On the Retention tab, an admin types an age and sees what a cleanup would
take now: in all, and by operation (recordings and their bytes, the largest
first, a page at a time). Nothing is deleted until one is run, every
operation's or one operation's from its row, and confirmed.

A cleanup runs in the background, 50 recordings at a time, each batch read
again as it goes: a task marked important since the preview keeps its
recordings. Core marks a recording first, then deletes its files. One whose
files the store did not delete gets its mark taken off again, and the
cleanup stops there, failed, for the next to take it again.

One cleanup runs at a time, an admin's or the policy's, for as long as it
takes. Stop ends it before its next recording: the one under way is taken
whole, and what it took stays taken. A core that stops while one runs marks
it failed, saying so. Activity keeps each run: who ran it (an admin, or the
Retention policy), its age, the operations it covered (named as they were),
what it found to take as it began, and the recordings it took and their
bytes, as it goes.

**Reclaim space** then gives the disk the bytes back ([Maintenance](#maintenance)).
SeaweedFS also does it on its own, once deleted files hold 30% of a volume.

### The retention policy

One for every operation, off until an admin turns it on, at an age (30 days
before anyone set one). On, core runs a cleanup of every operation's
recordings at the policy's age: at once when an admin turns it on, then a
day after the last began, or an hour after one that failed ended, if that is
sooner. Core looks every 10 minutes whether one is due.

The Retention tab's card shows the policy: on or off, its age, its last
cleanup and what it took, when the next runs, and who set it last. Its Edit
turns it on or off and sets the age; turning it on says what the first
cleanup takes now.

## Design notes

- **Retention for recordings alone.** Minion files and artifacts are what
  an operation gathered and built, and they stay as long as it does.
  Recordings grow with every desktop and terminal opened. Marking a task
  important is how operators keep the ones that matter.
- **A record stays.** A recording cleaned up keeps its record, marked, as an
  artifact deleted does: its task still says a desktop or a terminal was
  recorded, by whom and when, without its files.
- **Marked first, then deleted.** The mark keeps the encoder off a
  recording a cleanup takes, and comes off again when the store keeps its
  files: no record says cleaned up while its files stay, and no file stays
  that no record names.
- **Off until an admin turns it on.** On a store that has gathered
  recordings for months, a first cleanup takes all of them at once. Turning
  the policy on says what that takes first.
- **No copy kept.** A cleanup exports nothing first: operators keep a
  recording they need by marking its task important.
- **Deletes go through core.** Core keeps a record of every file it stores,
  and its views read those records: a file deleted in SeaweedFS alone would
  leave a recording or a download pointing at nothing. A cleanup deletes the
  files and marks their record together, and SeaweedFS frees the space
  afterwards.
- **Reclaim, volume by volume.** SeaweedFS's HTTP vacuum walks every volume,
  ten seconds apart, and answers once all are done: core could neither see
  where it was nor stop it. It also returns at once, having done nothing,
  while SeaweedFS's own vacuum holds the master's one lock. So core drives
  the reclaim itself, one volume a call over the master's gRPC, pauses
  SeaweedFS's own vacuum, and reads each volume on its server to know what
  happened to it.
- **No time limit, a stop instead.** A reclaim of a large store, or a first
  cleanup of months of recordings, takes as long as it takes: a limit would
  fail it halfway. What an admin needs is to see where it is, and to stop
  it.
- **Warnings by SeaweedFS's own accounting.** A bucket grows a volume when it
  needs one, and a volume server has room for about one a GB of free disk.
  The slots free say when writes will fail, whatever the disk's percentage
  says.
- **No quotas.** SeaweedFS enforces a bucket's quota by making it read-only.
  A full quota would then fail writes the way no free slot does, which is
  what the warnings exist to prevent.
- **No deleting volumes from the page.** Dropping empty volumes has no HTTP
  API, only SeaweedFS's shell, so it stays a step an admin runs there.
