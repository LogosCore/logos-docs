---
title: "Logos Documentation"
description: "How Logos works, the contracts between its parts, and how to build modules for it and contribute to it."
---

Logos is a modular team operations platform. A core server holds the
operators' work and is the one peer of every minion; modules connect it to
the minions: **channels** carry their traffic over a transport, and
**factories** build them. These docs explain how the parts work together,
specify the contracts between them, and guide you through building modules
and contributing to Logos.

## Where to start

| You want to | Read, in order |
|---|---|
| **Understand how Logos works** | [Architecture](architecture/), [Module Types](module-types/), [A minion's life at a glance](contracts/minion-messages/#a-minions-life-at-a-glance), and the [Glossary](glossary/) when a term is new |
| **Write a channel** | [Implementing a Module](implementing-a-module/), [Writing a Channel](guides/writing-a-channel/), then the channel contracts: [Minion Connection Schema](contracts/minion-connection/), [HTTP Sync](contracts/channel-core-sync/), [Connections](contracts/channel-core-connections/) |
| **Write a factory** | [Implementing a Module](implementing-a-module/), [Writing a Factory](guides/writing-a-factory/), [Writing a Minion](guides/writing-a-minion/), then [Minion Build](contracts/minion-build/) and [Minion Messages](contracts/minion-messages/) |
| **Contribute to Logos** | [Repositories](contributing/repositories/), [Development Stack](contributing/development-stack/), [Testing and CI](contributing/testing-and-ci/), [Changing the Protocol](contributing/changing-the-protocol/), [Writing the Docs](contributing/writing-the-docs/) |

## How these docs are organized

- **Concepts**: the parts and how they talk ([Architecture](architecture/),
  [Module Types](module-types/), [Core Responsibilities](core-responsibilities/),
  [Core Infrastructure](core-infrastructure/)).
- **Guides**: building a module and its minions, step by step, with the
  reference modules as examples.
- **Contracts**: the reference. Each page states what the code does, checked
  against it, and ends with the design notes behind it. The
  [Contracts Overview](contracts/overview/) maps them.
- **Contributing**: the repositories, the development stack, how changes are
  tested and released, and the rules the architecture keeps.

The code lives in the [LogosCore](https://github.com/LogosCore) repositories;
[Repositories](contributing/repositories/) says which holds what.
