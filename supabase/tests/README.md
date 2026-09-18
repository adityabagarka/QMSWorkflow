# Database test suites

Run with `npm run db:test`. Each file manages its own transaction and rolls
back, so a suite leaves nothing behind.

## These run against the real staging database

The deploy workflow runs them against Supabase, not a throwaway instance. That
is deliberate — §15's guarantees are worth proving where they actually have to
hold — but it imposes one rule:

**A test must not depend on production data, and must not collide with it.**

Fixtures therefore use `@example.test`, a reserved TLD that can never be a real
address, and each suite adds that domain to `allowed_email_domains` inside its
own transaction.

This is not theoretical. Deploy #4 failed because `020_onboarding.sql`
provisioned the real bootstrap address, `aditya@bagarka.in`. It passed for as
long as nobody had signed in with it, then failed the moment someone did — on a
_correct_ refusal by the code. The test was asserting that a real person did not
exist.

This has now bitten five times, in five different shapes:

1. **Deploy #4** — the suite provisioned the real bootstrap address, and broke
   the moment somebody signed in with it.
2. **Fixtures on `@plumhq.com`** — the same collision waiting on a real sign-up,
   found by inspection before it fired.
3. **Deploy #8** — `Admin sees every deal` asserted an absolute case count.
   Since an Admin sees every deal by design, it was counting production, and
   broke as soon as real deals existed.
4. **The review-gate coverage assertion** — "reviewing the terms that exist is
   not enough" only meant anything when the guardrails workbook had been
   imported, because the suite's own seed supplied exactly the three benefits
   its policy covered. On an empty catalogue it silently became "three of three
   is not complete" and failed. It now seeds a fourth benefit it deliberately
   leaves undecided until the end, so the assertion is about coverage rather
   than about whether an import happened to run first.

   This one hid for months because CI's pgTAP step could never run at all: the
   server was a Docker service container and the extension was installed on the
   runner. Worth remembering that **a suite nobody can run is not a passing
   suite** — the job was red for an unrelated reason, which read as "CI is
   broken" rather than "these proofs are not happening".

5. **A fixture GSTIN that was a real one.** `080` created a customer with
   `27AABCM1234N1Z5` — the app's own sample GSTIN, and therefore the one the
   first real deal was created with. Migration 0028 moved it out of that
   customer's name and into its `gstin` column, the unique index did exactly
   what it is for, and the staging deploy went red.

   Fixtures now use GSTINs beginning **99**, which is not an allocated GST
   state code — they run 01 to 38 — so a fixture identifier cannot collide with
   a real taxpayer. Same reasoning as `@example.test`, applied to the other
   identifier this system stores.

The general rule, which covers all five: **an assertion must be about the
fixtures, never about the database.** It extends to the identifiers a fixture
uses: an email, a GSTIN, or anything else the schema makes unique has to come
from a range that can never be real, or the fixture is a claim about what the
database does not contain. Concretely, counts are scoped to fixture
rows (`where owner_user_id in (select id from ids)`), never taken over a whole
table. "An Admin sees every fixture case" is a guarantee; "the system contains
six cases" is a measurement of production.

A corollary from the fourth: a suite must pass **in either order** — against an
empty database and against one with the workbook imported. Both are real states
(CI runs `db:test` before `db:import-guardrails`), and a suite that only passes
in one of them is measuring the import, not the schema. `050` now asserts the
empty-catalogue case explicitly, using `truncate ... cascade` inside its own
rolled-back transaction rather than naming the seven tables that reference
`benefit_key` — naming them would break on the eighth.

The one deliberate exception is the pair of assertions that `plumhq.com` is an
allowed sign-in domain and `gmail.com` is not. Those read live configuration on
purpose: they are a canary on the allowlist, and they create no rows.
