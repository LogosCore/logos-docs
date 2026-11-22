---
title: "Storage"
---

:::note[Status]
Built in part: the Storage page, its warnings and its two maintenance
actions. Retention cleanups are a draft ([below](#retention-cleanups)).
:::

Core keeps its files in an S3 object store, SeaweedFS ([Core
Infrastructure](../core-infrastructure/#seaweedfs--blob-storage)): what
minions send, recordings, builds, the wiki's attachments, skills. The
**Storage** page shows admins what the store holds and what would stop it
taking writes, and runs its maintenance. Core reads the store once a minute:
SeaweedFS's master, when core is set to reach it, and core's own records of
what it keeps in each bucket.

| Who | Can |
|---|---|
| `storage:read` (the admin role) | See the page, and the sidebar's count of its warnings |
| `storage:manage` (the admin role) | Run its maintenance. An agent key never does. |

## Where core keeps its files

A bucket is a SeaweedFS collection of the same name. Each kind of record core
keeps has a bucket of its own, named by a setting. The settings can name one
bucket for several purposes. The page sums each bucket's records by operation
and kind:

| Setting (default bucket) | Core keeps | Kinds |
|---|---|---|
| `MINION_FILE_BUCKET` (`minion-files`) | The files minions send, and the files operators upload for tasks | Task uploads, Screenshots, Downloads (a minion's file, or a stream core kept as it passed) |
| `DESKTOP_RECORDING_BUCKET` (`desktop-recordings`) | The desktops' and the terminals' recordings: a video once converted, else its parts | Desktops, Terminals |
| `BUILD_BUCKET` (`logos-builds`) | The files uploaded for builds, and their artifacts until deleted | Build files, Artifacts |
| `WIKI_IMAGE_BUCKET` (`wiki-images`) | The wiki's images not deleted | Images |
| `WIKI_FILE_BUCKET` (`wiki-files`) | The wiki's other attachments not deleted | Files |
| `SKILL_BUCKET` (`skills`) | Every version of every skill, no operation's | Skill versions |

A minion file counts once kept, or while it comes with its bytes so far. One
that failed or was stopped holds nothing: its chunks were dropped. Volumes
written outside any bucket are SeaweedFS's own files. A bucket core does not
name, a test's say, shows as not core's.

## The page

Three tabs:

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
- **Activity:** the maintenance run: what, by whom, when, how it went.

The same is in the GraphQL API: `storageStatus`, `storageConsumers` and
`storageActions` to read, `reclaimStorage` and `growStorageBucket` to act.

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
A core that stops while one runs marks it failed, saying so.

- **Reclaim space.** SeaweedFS compacts every volume, in every bucket, whose
  deleted files hold a tenth of it or more: their space comes back to the
  disk. It runs in the background, core waiting half an hour at most, and
  rewrites those volumes, so the store answers slower until it ends.
  Activity says how much it freed. SeaweedFS also compacts on its own, past
  30%.
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

The master's API takes no credentials: whoever reaches it can delete a
bucket's volumes. Keep it on core's network alone. The Compose file
publishes only the S3 port.

## Retention cleanups

:::caution[Draft]
A design, not built yet.
:::

Space comes back to the disk only once core deletes what it keeps. Today
that happens when:

- an operator deletes a recording, a build's artifact bytes, or a build;
- an operation is deleted, with everything core kept for it;
- core drops a task upload no task needs, and a build upload nothing refers
  to;
- the wiki's sweepers, when on (`WIKI_SWEEPER_ENABLED`), delete attachments
  no document refers to.

Minion files and artifacts stay until their operation is deleted: no
retention takes them. Retention is for **recordings** alone, the desktops'
and the terminals', which grow with every one operators open. A cleanup
takes the recordings that ended at least 30 days ago (an admin may name
another age), unless their task is marked important (the star an operator
puts on a task in a session's console). The mark keeps a task's recordings
for as long as it stays; unmarked, they are a cleanup's again. A recording
still recording is never taken.

A recording taken loses its files, video or parts, and keeps its record,
marked as cleaned up, with when: its task's Recordings tab still lists it.
A cleanup keeps no copy.

Admins run cleanups (`storage:manage`):

1. **Preview.** The cleanup names an age, and the operations it covers
   (every operation, or one). The page shows what it would take, by
   operation: recordings and bytes. Nothing is deleted.
2. **Run**, confirmed. Core deletes the recordings' files and marks their
   records, in batches, in the background. It takes only what still
   matches, so a task marked important since the preview keeps its
   recordings. Activity keeps the run: who, the age, how many recordings
   and bytes it took, and any failure.
3. **Reclaim space** gives the disk the bytes back. SeaweedFS also does it
   on its own, once deleted files hold 30% of a volume.

**The policy**, one for every operation: core runs the cleanup itself each
day, at the policy's age (30 days unless an admin sets another), each run on
Activity as a manual one is. It is off until an admin turns it on.

## Design notes

- **Retention for recordings alone.** Minion files and artifacts are what
  an operation gathered and built, and they stay as long as it does.
  Recordings grow with every desktop and terminal opened. Marking a task
  important is how operators keep the ones that matter.
- **A record stays.** A recording cleaned up keeps its record, marked, as an
  artifact deleted does: its task still says a desktop or a terminal was
  recorded, by whom and when, without its files.
- **No copy kept.** A cleanup exports nothing first: operators keep a
  recording they need by marking its task important.
- **Deletes go through core.** Core keeps a record of every file it stores,
  and its views read those records: a file deleted in SeaweedFS alone would
  leave a recording or a download pointing at nothing. A cleanup deletes the
  record and the file together, and SeaweedFS frees the space afterwards.
- **Reclaim covers every bucket.** SeaweedFS's vacuum takes a threshold, not
  a bucket, and answers once every volume is done. So core runs it in the
  background and says what it freed.
- **Warnings by SeaweedFS's own accounting.** A bucket grows a volume when it
  needs one, and a volume server has room for about one a GB of free disk.
  The slots free say when writes will fail, whatever the disk's percentage
  says.
- **No quotas.** SeaweedFS enforces a bucket's quota by making it read-only.
  A full quota would then fail writes the way no free slot does, which is
  what the warnings exist to prevent.
- **No deleting volumes from the page.** Dropping empty volumes has no HTTP
  API, only SeaweedFS's shell, so it stays a step an admin runs there.
