---
title: "Identity"
---

A minion's work may run as someone other than its process: a thread with
another token (impersonation), network-only credentials, commands started
through sudo or su. It says so with an `identity` item; the
[hello](../sessions/#hello) stays the process's.

Core never learns how the work got there. A command that changes who the
work runs as is the factory's, like any other ([Minion
Build](../../minion-build/#commands)): core queues it, sends it and takes
its result as any task's. What core knows is the `identity` item: it keeps
who the session's tasks run as, records each task as who it ran as, and
shows both.

## The item

```cddl
identity = {
  0: 20,                ; t: identity
  1: uint,              ; scope: 1 the session's tasks from now on,
                        ;   2 one task
  ? 2: task-id,         ; task: the task it is for (scope 2), or the task
                        ;   that made it (scope 1: a become, a steal_token)
  ? 3: tstr,            ; user, as the OS writes it ("CORP\\admin", "root")
  ? 4: tstr,            ; domain
  ? 5: uint,            ; integrity: the hello's levels
  ? 6: uint,            ; how: impersonation 1, network 2 (locally the
                        ;   process's own, on the network user), become 3;
                        ;   absent: the process's own
  ? 7: tstr,            ; credential: the id of the credential it took, one
                        ;   its task's args gave, named only once it was
                        ;   used and accepted
}
```

- **Scope 1** is the session's: who its tasks run as from now on, until
  the next (see [Message order](#message-order)). Without `how` (and so
  without a user), back to the process's own (a `rev2self`, an
  `unbecome`).
- **Scope 2** is one task's, whatever the session's: it needs `task`, and
  goes before the task's end. Without `how`, the task runs as the process's
  own: SSH's file commands, which go over the login's SFTP while its shells
  became root.
- A `how` names its user; one without says no user, domain, integrity or
  credential. `user` and `domain` are UTF-8, 256 bytes at most. A `how` or
  a level core does not know is kept and shown as its number.
- `credential` is one its task gave, so it names the task.
- **Any minion may send it, on every connection kind, in its next
  message.** One sent again changes nothing.

## Message order

Core takes a message's items in order. It records a task as who the
session's identity said when the task's `ack` came (or its first result,
when no ack came first). So a session's identity covers the tasks the
minion acks after it, until the next:

```text
ack      [task 1]                  ; task 1: as the session was
identity scope 1, root, task 1     ; from now on, root
ack      [task 2]                  ; task 2: as root
```

- **A minion acks in the order it took the tasks.** The tasks it took
  before a change go in an `ack` ahead of it, those after in one behind it:
  a message may carry several.
- **A task's own identity holds whatever the order.** Before its ack, the
  ack leaves it; after, it replaces what the ack recorded.
- **A task acked before a change that runs after it says who it ran as.** A
  minion that runs its tasks at once may take a task before a change and
  run it after: SSH's shell command queued right after a become, which
  waits for the become and runs as its user. Its own identity (scope 2)
  says so.

## What core keeps

| What | Set by | Shown |
|---|---|---|
| The session's **acting** identity | a scope 1 with a `how`; one without clears it | the Sessions table's User column (`alice → root`); the session's **Identity** tab |
| A task's **as** | its ack: the session's acting identity then, unless the task said its own; a scope 2, whenever it comes | the task's `as root`, when its identity has a `how` |
| The session's **history** | each change: the process's own, the session's, and a task's that has a `how` | the session's Identity tab, newest first |

- **The process's own** goes in the history as the session opens, and when
  a rehello changes its user, domain or integrity.
- **A session back to its process's own** is recorded with the process's
  user, so the history reads as who.
- **A task that says the process's own** leaves the history.
- **The history goes with its operation.**

GraphQL has them as `MinionSession.acting` and `MinionTask.as` (both a
`MinionIdentity`), and `minionIdentities(sessionId, after, first)`: a
session's history, newest first, a page at a time (100 by default, 500 at
most).

## Credentials

A credential an identity names must be one its task gave ([what a module
gets](../../credentials/#what-a-module-gets)). Core then marks it
**valid**, as a [login](../../credentials/#logins) that worked.

## What core answers

Nothing but an `err` ([Errors](../wire-format/#errors)):

- `unknown_task`, naming the task, for a task that is not the session's;
- `bad_message` for an item that does not read or breaks a rule above, or
  a credential its task did not give.

## On each connection kind

The same on every kind, in the minion's next message: a `reverse-call`
minion's next check-in, a `bind-call` page's answer to the call, a
persistent minion's message as it comes.

An agentless channel keeps nothing between calls, so core gives it the task
that made the session's acting identity with every call and open
([agentless channels](../../agentless-channels/#keys-for-the-channel)), and
the channel takes it up again on a new connection.

## Example

A session whose process runs as `alice`. The minion's items, in the order
they come, and what core records:

| The minion sends | Core records |
|---|---|
| `ack [1]`: task 1 becomes root | task 1: no `as` (the process's own) |
| `identity` scope 1, root, task 1 | acting: root; history: session, root |
| `ack [2]`: a shell | task 2: as root |
| `ack [3]`: task 3 becomes `other_user` | task 3: as root |
| `identity` scope 1, `other_user`, task 3 | acting: `other_user`; history: session, `other_user` |
| `ack [4]`: a shell | task 4: as `other_user` |
| `ack [5]`: task 5 goes back | task 5: as `other_user` |
| `identity` scope 1, no `how`, task 5 | acting: none; history: session, alice |
| `ack [6]`: a shell | task 6: no `as` |

Tasks 1 and 2 queued at once, with task 2 waiting for task 1:

| The minion sends | Core records |
|---|---|
| `ack [1, 2]` | tasks 1 and 2: no `as` |
| `identity` scope 1, root, task 1 | acting: root |
| `identity` scope 2, root, task 2 | task 2: as root; history: task, root |

## Design notes

**Identity is not a rehello.** A hello describes a process: replaced by a
token borrowed for a thread, it would lose who the process still is (what a
`rev2self` goes back to), and it has no place for two at once (network-only
credentials: locally the process, on the network another), nor for why (how,
the task, the credential). So the hello stays the process's, and `identity`
says who the work runs as.

**No parent link.** A minion that starts another (an elevation that spawns,
an injection) could tell it its parent's session only through the new
process (its command line, its environment, a file), which anyone on the
host can see. If core is to link them, it can match the spawning task's
result (the pid it started) with the new session's hello (its pid and
machine id), with nothing more on the wire.

**Recorded at the ack.** A minion says a change once, not with every task:
the tasks it acks after it run as it. The ack is where core learns the
minion has a task, so it is where the two meet; a task that runs as
another says so itself.
