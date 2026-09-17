# 0002 — Bootstrapping the first Super Admin

**Status:** accepted (M0)
**Relates to:** ARCHITECTURE.md §15

## Problem

§15 requires an Admin or Super Admin to approve every new user and assign their
role and manager. At first deploy nobody holds either role, so no one can
approve anyone — including the first Super Admin.

## Why not seed an `app_users` row

`app_users.id` must equal the Supabase Auth user id (see 0001), and that id does
not exist until the person signs in for the first time. A seeded row would
carry an invented UUID that never matches a real session, leaving a permanently
orphaned "Super Admin" and a real account still stuck as pending.

## Decision

Seed the _intent_ instead. `bootstrap_super_admins` holds an email address and a
`consumed_at` timestamp. On sign-in, `app.consume_bootstrap_super_admin()` looks
for an unconsumed grant for that email, and if it finds one promotes the
freshly-created user to `super_admin`/`active`, marks the grant consumed, and
writes the promotion to `audit_log` as a system action.

`FOR UPDATE SKIP LOCKED` makes the grant single-use even under two concurrent
first sign-ins. The table is append-only to the application, so a grant cannot
be quietly re-armed.

## Seeded value

`aditya@bagarka.in`, per the M0 decision.

`bagarka.in` is not the Plum Workspace domain, so it also appears in
`allowed_email_domains` — without that the bootstrap account could never sign in
to consume its own grant. Raised and **confirmed as intended**: `bagarka.in`
stays allowed.

This also forces the Google consent screen to be External rather than Internal —
see ADR 0006.

The consequence to keep in view is that two domains can reach the sign-in
screen, not one. Anyone with a `bagarka.in` Google account could sign in and
land in the access-request queue. They would still hold no role and see no
deals until an approver acted, so this widens who can _ask_ for access, not who
_has_ it. To close it later, delete the row from `allowed_email_domains` — no
code change or migration is needed.

## Consequences

- `bootstrap_super_admins` is environment-specific. Review it before any new
  deployment; expect it to be empty and fully consumed in production.
