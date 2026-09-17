# Setting up the staging environment

A step-by-step guide, written for someone who does not write code. You will not
need to write any. Everything here is filling in web forms and copying values.

There are three stages. Budget about 45 minutes in total.

1. Create the database (Supabase) — about 10 minutes
2. Create the Google sign-in credentials — about 20 minutes
3. Hand the values over so the system can be switched on — about 5 minutes

A note on why this part is yours rather than mine: these accounts are tied to
Plum's identity and billing, and the Google credentials control who can log in
to a system holding customer and medical data. They should be created by you,
under your account.

---

## Stage 1 — Create the database

**What this is:** Supabase is a hosting company that runs a PostgreSQL
database for you. PostgreSQL is the actual database software — the filing
cabinet where every deal, quote and user record lives.

1. Go to **supabase.com** and sign in. Signing in with GitHub is easiest, since
   the code already lives on GitHub.

2. Click **New project**.

3. Fill in the form:
   - **Name:** `qms-staging`
   - **Database password:** click Generate, then **save it in your password
     manager immediately**. You cannot see it again afterwards. It can be reset
     later, but that means redoing part of stage 3.
   - **Region:** choose **South Asia (Mumbai)**, shown as `ap-south-1`.
     This one matters. The system holds medical and personal data, and the rules
     it is being built to (India's DPDP Act, and IRDAI's norms for brokers)
     require Indian hosting. Picking any other region here would have to be
     undone later.
   - **Plan:** Free is fine for now. It is enough for staging.

4. Click **Create new project** and wait two or three minutes while it builds.

5. Now collect three values. Open a blank note to paste them into.

   Go to **Project Settings** (the gear icon) → **API**:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — a long string of letters and numbers

   Then go to **Project Settings** → **Database** → **Connection string**,
   choose the **URI** tab:
   - The **connection string** — looks like
     `postgresql://postgres:[YOUR-PASSWORD]@db.abcdefgh.supabase.co:5432/postgres`

   Replace `[YOUR-PASSWORD]` with the database password you saved in step 3.

**Which of these are secret?** The Project URL and the anon key are designed to
be public — they are sent to every visitor's web browser by design, and the
database's own security rules are what actually protect the data. The
**connection string is a real secret**, because it contains the database
password and bypasses those rules. Treat it like a bank password. It must never
be typed into the code, and it never gets committed to GitHub.

---

## Stage 2 — Create the Google sign-in credentials

**What this is:** rather than inventing its own passwords, the system asks
Google "is this really someone from Plum?" To ask that question, Google needs to
know the system exists. That is what you are registering here.

1. Go to **console.cloud.google.com** and sign in with your Plum Workspace
   account — not a personal Gmail account.

2. At the top of the page, create a new project. Call it `QMS Rollover`.
   Wait for it to finish, then make sure it is selected in the project dropdown.

3. In the search bar at the top, search for **OAuth consent screen** and open it.

4. Choose **Internal** and click Create.

   Internal means only people with a Plum Workspace account can ever sign in.
   External would let anyone with any Google account reach the login screen.
   Choose Internal.

   If Internal is greyed out, your account is not a Workspace administrator —
   ask whoever manages Google Workspace at Plum to do this stage, or to grant
   you the access.

5. Fill in the basics: App name `Rollover Quote Management`, and your email
   address for both the user support email and the developer contact. Save.

6. In the search bar, search for **Credentials** and open it.

7. Click **Create credentials** → **OAuth client ID**.
   - **Application type:** Web application
   - **Name:** `QMS Staging`
   - Under **Authorised redirect URIs**, click Add URI and paste:

     `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`

     Replace `YOUR-PROJECT-REF` with the bit from your Supabase Project URL —
     if your URL is `https://abcdefgh.supabase.co`, the reference is `abcdefgh`.

     This is the single most common thing to get wrong. If it does not match
     exactly, sign-in fails with a "redirect URI mismatch" error. If that
     happens, come back to this step and check it character by character.

8. Click Create. Google shows you a **Client ID** and a **Client secret**.
   Copy both into your note. The client secret is a real secret.

---

## Stage 3 — Connect the two together

1. Back in Supabase, go to **Authentication** → **Providers** → **Google**.

2. Turn Google on, paste in the **Client ID** and **Client secret** from
   stage 2, and click Save.

   Note that the Google secret goes into the Supabase dashboard, not into the
   code and not into GitHub. That is deliberate: §16 of the architecture
   requires credentials to live in a secrets manager rather than anywhere in the
   repository.

3. Send me the **Project URL**, the **anon key** and the **connection string**.
   I will then:
   - build the database structure (about 40 tables) in your new Supabase project
   - load the guardrails workbook into it — roughly 1,400 plans and their pricing
   - run the 67 automated checks that prove each of the six roles can see
     exactly the deals they are supposed to and nothing else
   - report back what passed

4. The first time you sign in, you become the Super Admin automatically, and
   can then approve everyone else from the access requests screen.

   **One thing to decide before then.** The Super Admin is currently set to
   `aditya@bagarka.in`, which is the address you gave me. That is not a
   `plumhq.com` address, so I had to add `bagarka.in` to the list of domains
   allowed to sign in at all. That leaves a second domain permanently admitted.
   If you would rather it were your `aditya@plumhq.com` address, tell me and I
   will change it — it is a one-line change, and then only Plum addresses can
   ever reach the system.

---

## Things that commonly go wrong

**"redirect URI mismatch" when signing in.** The address in stage 2 step 7 does
not exactly match your Supabase project. Check it character by character.

**"Internal" is greyed out in the Google consent screen.** Your account is not a
Workspace administrator. Someone who is will need to do stage 2.

**You lost the database password.** Supabase → Project Settings → Database →
Reset database password. Then rebuild the connection string with the new one.

**The free Supabase project gets paused.** Free projects pause after a week of
no activity. Opening the dashboard and clicking Restore brings it back with all
data intact. Worth upgrading to Pro once people are using it daily.
