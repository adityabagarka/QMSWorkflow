# 0006 — External Google consent screen, and a dedicated OAuth client

**Status:** accepted (M0)
**Relates to:** ARCHITECTURE.md §15, §16; ADR 0002

## Decision

The Google OAuth consent screen is **External**, and this system gets its own
Google Cloud project and OAuth client rather than reusing one from another app.

## Why External, when Internal is tighter

Internal restricts sign-in to the Plum Workspace, which is what §16 would prefer.
But the first Super Admin is `aditya@bagarka.in` (ADR 0002), which is not in that
Workspace. Under Internal, Google rejects that account before this system ever
sees it — and since nobody else can be approved until a Super Admin exists, the
system would have no way in at all.

Confirmed as a deliberate choice: keep `bagarka.in`, use External.

## What External does and does not mean

It means anyone with a Google account can reach the sign-in page. It does not
mean they can get in. `app.is_allowed_email_domain()` rejects any address
outside `allowed_email_domains` before a user record is created, and a permitted
address still lands at `status='pending'` with no role and no visible deals until
an approver assigns one. Four assertions in `020_onboarding.sql` cover this.

So the outer door is wider than Internal would make it; the inner door is
unchanged, and the inner door is the one carrying the §15 guarantees.

To close the outer door later — after moving the Super Admin to a `plumhq.com`
identity — switch the consent screen to Internal and delete the `bagarka.in` row
from `allowed_email_domains`. Neither is a code change.

## Publishing status

A new External app starts in **Testing**, which caps sign-ins at 100 named test
users and expires every authorisation after seven days. Both would be
mystifying in production use, so the app must be published.

Google's verification review is not required: it applies to sensitive and
restricted scopes (Gmail, Drive and similar). This system requests only name and
email, which are non-sensitive, so publishing takes effect immediately.

## OAuth client: shared with the existing quote workflow app

**Decided otherwise, deliberately.** The credentials are reused from the
existing quote workflow app, with separate secrets added for this deployment.

The reasoning given: the two are the same workflow serving different teams for
different use cases, and the other app's flow is expected to be merged into this
build later. §1 of the architecture anticipates that direction — renewal deals
are out of scope for phase 1 with the instruction to "build the architecture so
these slot in without rework" — so a shared sign-in identity is consistent with
where this is going, rather than an expedient.

The case against reuse, for the record, since it is worth revisiting at merge
time:

**The consent screen belongs to the Google Cloud project, not the client.** Its
app name is what users read at sign-in. If that name describes the other app,
people signing in to this one are asked to "continue to" something that is not
what they opened. Worth checking what the name currently reads as, and setting
it to something that covers both — the two are merging anyway.

**Shared blast radius.** One leaked or rotated secret takes down both systems at
once. Acceptable while they are converging; a reason to keep the rotation
procedure written down.

**§16 wants separable credentials.** Vendor and access records form part of the
SOC 2 / ISO 27001 evidence trail. A shared client means access for the two
systems cannot be revoked independently — which is fine when they are one system,
and should be settled either way before the compliance review rather than
discovered during it.
