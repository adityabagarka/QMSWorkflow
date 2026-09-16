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

**This requires attention:** `bagarka.in` is not the Plum Workspace domain, and
the domain allowlist rejects everything outside it. The address must therefore
appear in `ALLOWED_EMAIL_DOMAINS` or the bootstrap account can never sign in to
consume its own grant. `.env.example` currently lists both domains for that
reason. If the intent was a `plumhq.com` identity, change both the seed in
`0010_bootstrap_super_admin.sql` and the allowlist, and drop `bagarka.in`.

## Consequences

- `bootstrap_super_admins` is environment-specific. Review it before any new
  deployment; expect it to be empty and fully consumed in production.
