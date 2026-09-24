---
title: "ADR-0005: OpenID Connect Login for Core"
---

## Status
Accepted

## Context

`logos-core` authenticated operators only with a local username and bcrypt
password. Teams that already run an identity provider (Keycloak in the first
deployment, but Authentik, Entra ID and Okta are all in scope) need operators
to sign in with their organisation account, get MFA from the provider, and lose
access centrally when they are off-boarded.

The existing session model (short logos-signed access JWT, Redis-backed refresh
rotation, double-submit CSRF, API and agent keys for scripts) is well tested
and must not change. SSO must also be optional: a fresh install with no
identity provider keeps working, and a provider outage must not lock
administrators out.

## Decision

Core acts as an **OpenID Connect relying party** using the Authorization Code
flow with PKCE against any provider that publishes a discovery document.

- **Only authentication changes.** After the provider callback core calls the
  same session-issuance path as the password login. SSO sessions are ordinary
  Logos sessions; refresh, CSRF, session listing and revocation, GraphQL
  authorisation and the SPA bootstrap are untouched. Provider tokens are used
  once and never stored.
- **Per-login state travels in an encrypted cookie**, not a server-side row:
  state, nonce, PKCE verifier and the return path are sealed with AES-GCM under
  a key derived from the JWT secret. The callback can land on any replica and
  there is nothing to leak or expire server-side.
- **Just-in-time provisioning.** Accounts are keyed by `(issuer, subject)`.
  The first successful login creates the local user; later logins re-sync
  roles from the provider. Optionally an existing local account
  with the same username can be adopted (`OIDC_LINK_EXISTING_BY_USERNAME`).
- **Roles come from claims.** A configurable claim path (Keycloak realm roles
  by default) is mapped through `OIDC_ROLE_MAPPING` to Logos roles, falling
  back to `OIDC_DEFAULT_ROLES`; no role means no login. The provider is the
  source of truth and is re-applied on every SSO login.
- **Local login stays available** and can be switched off only when SSO is
  on. `/enroll` for the first admin is unaffected. A provider that cannot be
  discovered at boot degrades to "SSO unavailable" instead of failing core.
- **Local logout only.** Logging out of Logos does not end the provider
  session (RP-initiated and back-channel logout are deferred).

Configuration is entirely through `OIDC_*` and `AUTH_LOCAL_LOGIN_ENABLED`
environment variables, mirrored in the Helm chart. The full design, threat
model and provider notes live in the core repository at
`docs/oidc-auth-design.md`.

## Consequences

**Positive**

- Operators get provider-managed credentials and MFA; off-boarding at the
  provider stops new logins immediately and existing sessions expire on
  Logos's normal schedule.
- No change to the session, CSRF, API-key or agent-key model; every existing
  test and client keeps working.
- Any discovery-compliant provider works with the same code; Keycloak ships as
  a one-command dev instance with a realm import.

**Negative / trade-offs**

- Role changes at the provider reach Logos on the user's next SSO login, not
  instantly. Deactivating the user in Logos remains the immediate lever.
- Provider-side logout is not propagated; a user who signs out of Logos and
  clicks the SSO button again is re-authenticated silently while the provider
  session lives.
- Usernames are taken from a provider claim; a collision with an unlinked local
  account fails the login unless linking is explicitly enabled.
- One provider per deployment.
