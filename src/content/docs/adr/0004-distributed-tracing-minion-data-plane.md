---
title: "ADR-0004: Distributed Tracing for the Minion Data Plane"
---

## Status
Accepted

## Context

The [Architecture Draft](../../architecture/) and
[Core Infrastructure](../../core-infrastructure/) describe an "Observability
Stack" covering logs, metrics, and traces, but leave the role unimplemented and
the tooling unprescribed. [`future-steps.md`](../../future-steps/) lists
"Observability baseline (logs, metrics, traces)" as candidate ADR #5.

An earlier revision of [Core Infrastructure](../../core-infrastructure/) removed
the telemetry arrows from **modules** to the observability block over a security
concern: a fuzzy, push-everything path from less-trusted module containers into
core/observability internals expands attack surface, and routing telemetry
*through core* overloads the control plane. That left the minion data path with
no end-to-end visibility at all.

This ADR addresses **only distributed tracing**, and only for the **minion data
plane** — the server-side handling of a single minion request. **Audit logging
(FR-09) and metrics are explicitly out of scope** and remain deferred; this ADR
delivers the *traces* portion of the backlog item and nothing else.

The motivating need is operational: when a minion check-in misbehaves, an
operator must be able to follow that one request across every Logos-controlled hop
that served it — channel ingress, the HTTP sync into core, core's internal
processing, and (in future) the minion factory — and see where it slowed or
failed. The [AMQP envelope](../../contracts/amqp-envelope/) already carries a
`correlation_id`, but that pairs one RPC request to its reply; it is not an
end-to-end trace across transports.

## Decision

Adopt **OpenTelemetry with W3C Trace Context** to trace the minion data plane,
exported to a single hardened collector. Operator/API/UI paths are **not**
traced.

### 1. Scope — the minion data plane only

The traced surface is exactly the server-side path that serves one minion
request:

```
minion → channel → (HTTP sync) → core → core internal logic → (HTTP response) → channel
```

Instrumentation inside core is **path-scoped**: the `POST /api/channel/sync`
handler and the logic it drives are instrumented; the operator-facing
REST/GraphQL resolvers, the Logos API, and the UI are **deliberately left
uninstrumented**. Tracing follows the data plane, not the control plane.

Because sync is **not batched — one sync carries exactly one minion message** —
a single minion request maps to exactly **one trace**. The channel→core call is
the sync `POST`; the `core→channel` return is that request's HTTP response,
captured within the same trace (not a new hop).

### 2. Trust boundary — tracing begins at the channel, never the minion

The minion is implant code on a compromised target and is **never** part of the
observability plane:

- Trace context is **never propagated onto the target host**. The minion emits
  no spans and carries no trace headers.
- The **channel module mints a fresh root span** when a minion request arrives
  at its inbound edge. Any `traceparent`-looking value arriving from the minion
  side is **untrusted and discarded** — never adopted as parent context.
- The traced perimeter is the controlled infrastructure (channel, core, and
  future factory participation). Delivery *back* to the minion is outside the
  trace.

This is an opsec requirement, not a convenience: a minion beaconing spans to a
collector would create an attributable signature and reveal Logos infrastructure.

### 3. Standard and context propagation

- **OpenTelemetry SDK** for instrumentation; **W3C Trace Context**
  (`traceparent`, optional `tracestate`) as the wire format. Vendor-neutral, so
  the backend stays swappable.
- **HTTP** (`channel → core` sync and its response): standard `traceparent`
  request header.
- **AMQP** (core ↔ module RPC, used by the future factory leg): `traceparent`
  carried in **AMQP message headers**, *not* as a field in the
  [ADR-0002 envelope](../0002-amqp-contract-conventions/). This keeps the frozen
  business envelope stable and the transport/observability concern separate.
- `trace_id` and `correlation_id` **coexist with distinct jobs**: `trace_id` is
  the end-to-end causal tree; `correlation_id` remains the per-RPC
  request↔reply pairing from ADR-0002, unchanged.

### 4. Export topology — push-only gateway collector

- Modules and core export spans to a single, hardened **OpenTelemetry Collector
  (gateway)** over OTLP, **mTLS**, on a dedicated observability network segment.
- The collector is the **only** component that talks to the trace backend.
  Modules cannot reach the backend, cannot query traces, and **nothing flows
  back** to the module. The data flow is one-way: spans in.
- Spans **do not ride the AMQP control plane** and are **not routed through
  core**. The collector — not core, not the backend — is the trust boundary.

This is the narrow, audited replacement for the broad arrows that were removed:
a single-purpose, push-only receiver instead of "modules → observability."

### 5. Sampling — always-on for MVP, throttled at the channel root

- **Parent-based, head sampling at ratio `1.0` (always-on)** for MVP. The
  channel's root span makes the keep/drop decision and stamps it into the
  propagated `traceparent`; every downstream hop honors it, so each trace is
  kept or dropped **whole**.
- The sampling ratio is a **config knob located at the channel root** — the
  single point where every minion trace is born and where the minion has no say.
  When minion volume grows, dial the ratio down there.
- **Tail-based sampling** (e.g. keep 100% of errored/slow check-ins, sample the
  rest) is a **collector-side** capability and can be switched on later **with
  no code change**, because all spans already flow to the gateway.

### 6. Span data and redaction

Spans carry **identifiers and metadata only** — `trace_id`, message/envelope
ids, message `type`, `profile_id`, payload **size**, hop **duration**, and
status/error. Spans **must never** contain `encrypted_data` payloads, decrypted
plaintext, or key material (consistent with NFR-01: keys are isolated to core,
secrets never in plaintext). Channel spans are limited to what a
**plaintext-blind** channel can see — transport metadata and the encrypted
blob's id.

### 7. Future — the minion factory joins the data-plane trace

For MVP the **minion factory is build-time only** and is **not** in the live
trace path. Later, the factory will participate in **processing minion payloads
at runtime** — because only the factory that built a given minion knows how to
decode its payload format (the factory-owned translator hooks). When that lands,
`core → factory → core` becomes a **child span** of the minion trace, stitched
by the **same AMQP-header propagation standardized in §3** — no rework to the
envelope or the collector. The design is chosen now so the factory drops in
cleanly then.

### 8. Tech stack — OTel → Collector → Tempo on SeaweedFS, Grafana UI

The stack is **decided**, not left open:

- **Instrumentation**: **OpenTelemetry Go SDK** — forced by the Go core and
  modules; vendor-neutral, keeps everything downstream swappable.
- **Gateway**: **OpenTelemetry Collector (contrib distribution)** — the mTLS
  trust boundary (§4) and the home for tail-sampling and redaction processors
  (§5, §6). The collector is the boundary **independent of the backend**, so the
  backend can change without touching the export topology or the application.
- **Backend**: **Grafana Tempo**, with its trace blocks stored in
  **SeaweedFS** via Tempo's S3-compatible backend. This **reuses the
  object storage the platform already operates**
  ([SeaweedFS](../../core-infrastructure/#seaweedfs--blob-storage)) — no new
  database, no external cloud dependency, cheap retention at scale.
- **UI**: **Grafana**, querying Tempo for trace search and the
  service-graph/waterfall views.

The collector still speaks plain **OTLP** in, so swapping Tempo for another
backend later remains a backend-only change.

## Consequences

### Positive

- One minion request is one queryable trace across channel, HTTP sync, and core
  — the operational "where did this check-in go?" question becomes answerable.
- Restores module participation in observability **without** the security
  problems that got it removed: push-only, mTLS, gateway-isolated, never through
  core, never from the minion.
- Vendor-neutral (OTel + W3C) — tail-based sampling is a later config flip, and
  because the collector speaks plain OTLP, the backend stays swappable.
- **Tempo stores trace blocks in the SeaweedFS the platform already runs** — no
  new database and no external cloud dependency for trace retention; the
  observability stack adds only the collector, Tempo, and Grafana as containers.
- The future factory payload-processing leg is pre-wired via AMQP-header
  propagation; adding it is incremental.

### Negative / Costs

- Three new runtime components (OTel Collector gateway, Tempo, Grafana) must be
  deployed, secured (mTLS, dedicated segment), and operated. Tempo also needs a
  dedicated SeaweedFS bucket/path and credentials scoped to traces only.
- **Always-on sampling points at the minion firehose.** Minion check-ins are the
  highest-volume traffic in the system; at realistic fan-out, `1.0` can pressure
  the collector and backend. Mitigation is the channel-root ratio knob (§5), but
  the default ships hot and must be watched.
- Every module and the core sync path take an OTel SDK dependency and
  context-propagation plumbing.

### Tradeoffs

- Tracing follows the **data plane only**; operator/API/UI actions are
  intentionally invisible to tracing. Auditing those is a separate concern
  (FR-09), deferred.
- Carrying context in AMQP **headers** (not the envelope) favors a stable
  ADR-0002 contract and standard W3C propagation over a single self-documenting
  envelope field.
- Minting a fresh root at the channel (discarding inbound minion context) trades
  a theoretical minion-to-server trace continuity — which we never want — for a
  hard opsec boundary.

## Implementation Notes

- This ADR **supersedes** the [Core Infrastructure](../../core-infrastructure/)
  revision that removed the module→observability arrows. The topology diagram
  should restore module participation, but as arrows to the **trace collector**
  specifically (push-only), not to a generic observability block and not through
  core. Update `core-infrastructure.md` (and its `uk/` mirror) accordingly.
- This ADR delivers only the **traces** slice of `future-steps.md` candidate #5;
  **audit logs and metrics remain deferred** and should stay listed there.
- First instrumentation surfaces: the channel inbound edge (root span), the
  channel→core sync HTTP client, and core's `POST /api/channel/sync` handler.
- Add the ADR to the Starlight sidebar in `astro.config.mjs` (with the Ukrainian
  translation label) and create the `uk/` translation alongside it.
