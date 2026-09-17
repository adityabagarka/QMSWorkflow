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

## Why a dedicated OAuth client

Reusing an existing client from another application would work technically — a
client can carry several redirect URIs — but is rejected for three reasons.

**The consent screen belongs to the Google Cloud project, not the client.** Its
app name is what users read at sign-in. Reusing another project's client means
people signing in to an insurance system holding customer medical data are asked
to "continue to" an unrelated app. That is precisely the shape of a phishing
prompt, and it trains people to click past exactly the screen they should read.

**Shared blast radius.** One leaked or rotated secret takes down both systems at
once, and this one cannot be casually taken down.

**§16 wants separable credentials.** Vendor and access records form part of the
SOC 2 / ISO 27001 evidence trail, and access for this system needs to be
revocable on its own.

If a separate Google Cloud project is genuinely unwanted, the acceptable middle
ground is a **new OAuth client inside the existing project** — separate client
ID and secret, so the blast-radius and revocability problems go away. The shared
consent-screen name remains, so this is only reasonable where that name already
reads as a neutral Plum-branded sign-in.

Reusing the same client ID and secret across both apps is not recommended in any
case.
