---
title: "Architecture Rules"
---

The rules every change keeps. Each says why in a line, and links to where
the docs explain it.

1. **One core instance.** Core runs as one process, and the Helm chart runs
   one replica. Why: its event bus, its background jobs and minions' open
   connections live in the process. Scaling out is not built, and three
   rules keep it a contained change: MongoDB and Redis decide, and a process
   only caches what it reads; every push to a minion connection goes through
   one interface, send to a session, never a socket its caller holds; a
   periodic job is safe to run in two processes at once (a conditional
   update, or a lease like the build scheduler's).
   [One core instance](../../architecture/#one-core-instance).

2. **Channels are plaintext-blind.** A channel hands core a minion's sealed
   frame and the id it was sent under, and never opens one. Why: core is the
   minion's peer and holds its keys, and a channel stands on the internet
   side. The exception is an agentless kind, whose channel acts as the
   minion and gets the keys of each call and open; any other channel never
   sees a key. [Communication Ownership
   Model](../../architecture/#communication-ownership-model), [Keys for the
   channel](../../contracts/agentless-channels/#keys-for-the-channel).

3. **Modules talk to core alone, and core knows no particular module.**
   Modules never call each other. What a module can be managed on, its
   status values, action results and log records are its own declarations,
   which core shows as they come. Why: a module is deployed and replaced on
   its own, and core holds no knowledge of any one of them.
   [Communication Model](../../architecture/#communication-model), [Shared
   rules](../../contracts/overview/#shared-rules).

4. **The SDKs are plumbing.** module-core, channel-core and factory-core
   hold the session, management serving, the log tail and the transports to
   core; they add no actions or properties of their own, factory-core's
   builds section being the one exception. Anything that depends on what a
   module is (its manifest, what an action does, its log records) stays in
   the module. Why: a fix to the plumbing reaches every module, and only a
   module knows what its own actions mean. [What stays in the
   module](../../implementing-a-module/#what-stays-in-the-module).

5. **Minions share only the protocol.** BOB's minion, the Dumbo page, the
   SSH channel's minion and Raven's script each keep their own task runner
   and workings; there is no shared minion library. Why: none waits on
   another's changes. [The SSH Module, Design
   notes](../../modules/ssh/#design-notes).

6. **Module instance ids are global.** Core keys registrations by instance
   id alone, whatever the module's type or name: a module that registers
   under an id in use takes that instance over, its stored configuration and
   history included. So no two modules default to the same id, a channel
   and a factory of one repository included (the dev stack's: `http-local`,
   `tcp-local`, `bob-local`, `dumbo-local` and `dumbo-factory-local`,
   `ssh-local` and `ssh-factory-local`, `raven-local`). Why: heartbeats,
   deregistering and management address an instance by its id alone.
   [`module.register`](../../contracts/module-lifecycle/#moduleregister).

7. **Every schema field is numbered, and a number is never reused.** A
   connection schema's fields and target fields, a build schema's channels,
   fields and connection parameters, a command's `op` and its params' `num`,
   and every key, item type and value of the minion messages. Core refuses a
   schema missing a number. Why: minions are built with the numbers and read
   by them; a number given to another field would be misread by every minion
   already built. [Field
   numbers](../../contracts/minion-connection/#field-numbers),
   [Commands](../../contracts/minion-build/#commands),
   [Registry](../../contracts/minion-messages/wire-format/#registry).

8. **A channel's handler returns when its context ends.** A call's handler
   and an open's opener stop waiting on the far side when their context
   ends (a call's at core's deadline or when the control link drops, an
   open's at its deadline): close the transport then, and bound any wait
   that closing cannot end. Why: channel-core opens the
   control link again only once every call and open in progress has
   returned, so one that hangs leaves the whole channel without a link.
   [`bind-call` minions: when core
   calls](../../contracts/channel-core-connections/#bind-call-minions-when-core-calls).

9. **Secrets are never logged.** Key material, credentials, secret values
   and files go where they are for alone: never into logs, build progress
   or a build's log, and never back to core. Channels log no frame, and the
   SSH channel, which reads messages, logs none of their contents. Why: a
   module's log goes to its log store and, live, to any operator who opens
   its tail. [What a module
   gets](../../contracts/credentials/#what-a-module-gets), [The
   builder](../../guides/writing-a-factory/#the-builder), [Module
   Logs](../../contracts/module-logs/).
