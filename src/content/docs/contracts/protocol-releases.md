---
title: "Protocol Releases"
---

Every release of `logos-golang-protocol`, the package that holds the wire
types and rules every module and core share, newest first: when a field,
item or action came. Each module's own releases are in its repository's tags,
and [Repositories](../../contributing/repositories/) says which version of
the protocol each one is on. While the protocol is pre-1.0, a minor release
may change what an earlier one said: the repositories a change affects move
to it in the same release round
([Changing the Protocol](../../contributing/changing-the-protocol/)).

| Version | Date | What it brought |
|---|---|---|
| [v0.54.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.54.0) | 2026-11-12 | The live build log: `factory.build.log`, a running build's output line by line, each line with its step; optional, the result's `log` kept for a factory without it |
| [v0.53.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.53.0) | 2026-11-12 | Build fields for some platforms: `platforms` |
| [v0.52.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.52.0) | 2026-11-12 | Minion error codes per build: drawn by core, fixed ones kept |
| [v0.51.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.51.0) | 2026-11-11 | Minion error codes |
| [v0.50.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.50.0) | 2026-11-11 | Minion config; every field numbered |
| [v0.49.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.49.0) | 2026-11-10 | Build links: a path on core's address, or an absolute URL |
| [v0.48.2](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.48.2) | 2026-11-10 | JSON envelope test: items compared as CBOR values, any map order |
| [v0.48.1](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.48.1) | 2026-11-09 | JSON envelope: compile where int is 32 bits |
| [v0.48.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.48.0) | 2026-11-09 | Codecs: core's JSON envelope, a build's codec, the factory link |
| [v0.47.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.47.0) | 2026-11-09 | Compression: the packed item, DEFLATE |
| [v0.46.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.46.0) | 2026-11-09 | Delegation of minion messages: the delegate item, two actions, serves |
| [v0.45.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.45.0) | 2026-11-08 | Reverse tunnels: udp only in a command that opens udp |
| [v0.44.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.44.0) | 2026-11-08 | Tunnels wave 4: the VPN front, its link, ICMP |
| [v0.43.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.43.0) | 2026-11-08 | Params by a condition and More options; the reverse tunnel's front dropped |
| [v0.42.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.42.0) | 2026-11-08 | Tunnels: reverse SOCKS dropped |
| [v0.41.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.41.0) | 2026-11-08 | Tunnels: stop_idle one of core's params |
| [v0.40.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.40.0) | 2026-11-08 | Tunnels: processes, accepts, tunnel_ctl |
| [v0.39.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.39.0) | 2026-11-07 | Tunnels: unix sockets, named pipes, a source address, TLS |
| [v0.38.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.38.0) | 2026-11-07 | Tunnels: core's fronts, what a command opens, an open read strictly |
| [v0.37.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.37.0) | 2026-11-07 | Reverse port forwards: tunnel_listen (item 27), core-only and optional params |
| [v0.36.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.36.0) | 2026-11-07 | Tunnels: items 21 to 26, socks_proxy and port_forward |
| [v0.35.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.35.0) | 2026-11-06 | Minion identity: the identity item, the link's acting |
| [v0.34.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.34.0) | 2026-11-05 | Credential fields: credential and credential_list |
| [v0.33.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.33.0) | 2026-11-05 | Connection kinds' max_open; the reack item (19) |
| [v0.32.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.32.0) | 2026-11-05 | Agentless keys on calls and opens, under, max_call; drop the none suite |
| [v0.31.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.31.0) | 2026-11-04 | agentless channels (the none suite, agentless kinds, link failures login and host_key, machine source ssh-host-key, ValidateAgentless, ValidateBuildMessage), FormatMultiline |
| [v0.30.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.30.0) | 2026-11-03 | feedback item (18), minion to core: warnings and errors with id, level, msg, code, task, at, count |
| [v0.29.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.29.0) | 2026-11-03 | volumes result and list_volumes action; max_tasks item, hello key and build schema/request fields; max_tasks reserved as a core command |
| [v0.28.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.28.0) | 2026-11-03 | poll item, core's at and err stale, err ctx, connection max_message, command kinds |
| [v0.27.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.27.0) | 2026-11-03 | build failover settings (BuildFailover, ConnectionFailover, BuildSchema.Failover) |
| [v0.26.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.26.0) | 2026-11-02 | connect/disconnect reserved as core commands; link answer peer (key 9); err item task (key 4) |
| [v0.25.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.25.0) | 2026-11-02 | transfer ctx (chunk, ack), task ctx (result part, cancel), the resume item |
| [v0.24.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.24.0) | 2026-11-02 | the control link (call, open, answer), the rehello item, target values for bind kinds |
| [v0.23.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.23.0) | 2026-11-02 | connection kinds, fields per kind, connection management |
| [v0.22.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.22.0) | 2026-11-01 | Minion messages v3: numbered values, commands and result data |
| [v0.21.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.21.0) | 2026-11-01 | Minion messages v2: numbered keys, item types and err codes |
| [v0.20.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.20.0) | 2026-11-01 | listings on result parts (ls), walk_dir and dir_walk |
| [v0.19.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.19.0) | 2026-10-31 | delete_path (an action with no result) |
| [v0.18.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.18.0) | 2026-10-31 | stream uploads (stream param, stream offers); upload_stream |
| [v0.17.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.17.0) | 2026-10-31 | streams (ack hold); file_stream and stream_file |
| [v0.16.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.16.0) | 2026-10-31 | uploads (a file param for commands, FileOffer); file_upload and upload_file |
| [v0.15.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.15.0) | 2026-10-31 | file transfers (chunk item); file_download and download_file |
| [v0.14.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.14.0) | 2026-10-31 | a command's result and action, in place of its handler |
| [v0.13.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.13.0) | 2026-10-31 | the hello's machine_id |
| [v0.12.1](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.12.1) | 2026-10-31 | a result handler's command gives every other param a default |
| [v0.12.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.12.0) | 2026-10-31 | task result handlers (BuildCommand.Handler, dir_listing); result data as raw CBOR |
| [v0.11.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.11.0) | 2026-10-31 | minion tasks (task, cancel, result, ack items; task args); help reserved for core |
| [v0.10.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.10.0) | 2026-10-30 | a minion's check-in schedule (the hello's sleep, sleep_update) |
| [v0.9.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.9.0) | 2026-10-30 | persisted sessions (hello sid, session_replaced, the build schema's persisted_sessions, the build request's session_id) |
| [v0.8.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.8.0) | 2026-10-30 | minion messages (sealed frame, CBOR messages: stage, hello, get_tasks, err), the sync call's Logos-Peer-Address |
| [v0.7.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.7.0) | 2026-10-29 | — |
| [v0.6.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.6.0) | 2026-10-29 | — |
| [v0.5.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.5.0) | 2026-10-26 | — |
| [v0.4.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.4.0) | 2026-10-25 | minion connection schema, string_map, field format |
| [v0.3.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.3.0) | 2026-10-25 | module management manifest and RPC payloads, live log streaming, manifest capabilities, status alert values |
| [v0.1.0](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.1.0) | 2026-09-24 | — |
| [v0.2.1](https://github.com/LogosCore/logos-golang-protocol/releases/tag/v0.2.1) | 2026-09-24 | — |
