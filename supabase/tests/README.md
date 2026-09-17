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

This has now bitten three times, in three different shapes:

1. **Deploy #4** — the suite provisioned the real bootstrap address, and broke
   the moment somebody signed in with it.
2. **Fixtures on `@plumhq.com`** — the same collision waiting on a real sign-up,
   found by inspection before it fired.
3. **Deploy #8** — `Admin sees every deal` asserted an absolute case count.
   Since an Admin sees every deal by design, it was counting production, and
   broke as soon as real deals existed.

The general rule, which covers all three: **an assertion must be about the
fixtures, never about the database.** Concretely, counts are scoped to fixture
rows (`where owner_user_id in (select id from ids)`), never taken over a whole
table. "An Admin sees every fixture case" is a guarantee; "the system contains
six cases" is a measurement of production.

The one deliberate exception is the pair of assertions that `plumhq.com` is an
allowed sign-in domain and `gmail.com` is not. Those read live configuration on
purpose: they are a canary on the allowlist, and they create no rows.
