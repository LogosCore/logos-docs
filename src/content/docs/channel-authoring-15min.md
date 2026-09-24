---
title: "Author Your Own Channel in 15 Minutes"
---

This guide shows the shortest path to build a custom channel module using:

- `logos-golang-protocol`
- `logos-golang-channel-core`

## 1) Bootstrap module

```bash
mkdir my-channel && cd my-channel
go mod init github.com/you/my-channel
go get github.com/logoscore/logos-golang-channel-core@v0.3.0
```

## 2) Implement transport envelope

Your transport adapter only needs to satisfy `TransportEnvelope`:

- `SourceKey()`
- `GetField(location,key)`
- `SetField(location,key,value)`

## 3) Load profiles

Use `profile.ParseYAMLProfiles(...)` from channel-core to load YAML profile set.

## 4) Resolve profile + run runtime

Flow per inbound message:

1. Detect hint (`profile_id`) from transport if present.
2. `matcher.Resolve(ctx, hint, profiles)`
3. Extract `id` + `encrypted_data` using resolved mapping refs.
4. `runtime.HandleWithProfile(ctx, envelope, channelID, resolvedProfile)`
5. Return outbound mapped values via transport.

## 5) Keep it simple

Your custom module should focus on transport-specific logic only:

- where fields are located
- how request/response is carried
- runtime delegation to channel-core for canonical flow

That’s the core idea: low-boilerplate channel development for the community.
