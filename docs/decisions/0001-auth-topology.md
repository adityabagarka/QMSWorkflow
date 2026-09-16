# 0001 — Auth topology: Supabase Auth with Google as the OIDC provider

**Status:** accepted (M0)
**Relates to:** ARCHITECTURE.md §3.1, §15, §16

## Decision

Google Workspace SSO runs through Supabase Auth's Google OIDC provider. RLS
policies resolve the current user through `app.current_user_id()`, and
`app_users.id` is the Supabase Auth user id rather than a separate surrogate
key.

## Why

Asked for the option that was easiest to implement. Supabase Auth gives native
JWT-backed RLS with no session plumbing, which is what §3.1 wants validated on
real Postgres now.

## Containing the migration cost

The obvious objection is lock-in: §3.1 expects this schema to move to RDS or
Cloud SQL later. Two things keep that cheap.

`app.current_user_id()` reads the `request.jwt.claims` GUC directly rather than
calling `auth.uid()`, and falls back to an `app.current_user_id` GUC. So the
schema has no dependency on the Supabase `auth` schema existing at all —
migrations and the pgTAP suite run against a stock Postgres today, which is how
the §15 tests are able to run without Supabase present.

Replacing Supabase Auth therefore means changing one function body and the
session-establishment code, not 127 policies.

## Consequences

- MFA is enforced at the Google Workspace IdP, not in the application (§16).
- `app_users` rows are created on first sign-in, so a user row cannot exist
  before an auth identity does. This is what forces the bootstrap mechanism in 0002.
- `service_role` bypasses RLS. It must not be used as a general-purpose
  application credential; the grants in `0009_grants.sql` deliberately still
  bind it, which is what keeps `audit_log` append-only for server-side code.
