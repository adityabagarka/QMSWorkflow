# Setting up the staging environment

A step-by-step guide, written for someone who does not write code. You will not
need to write any. Everything here is filling in web forms and copying values.

There are four stages. Budget about an hour in total.

1. Create the database (Supabase) — about 10 minutes
2. Create the Google sign-in credentials — about 20 minutes
3. Connect the two together — about 5 minutes
4. Build the database by pressing a button on GitHub — about 15 minutes

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

     `https://exfiksdvnctzxkwswwgk.supabase.co/auth/v1/callback`

     That is already filled in for your project — copy it exactly as written,
     including the `/auth/v1/callback` on the end.

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

---

## Stage 4 — Build the database

**Read this first: I cannot do this step for you.** The environment I run in
blocks all network access to Supabase — both the database and the website. That
is a restriction on my sandbox, not a problem with your project. So the build
has to run somewhere with normal internet access.

The easiest such place is **GitHub Actions**: a free service, built into the
repository you already have, that runs commands on a machine in the cloud. You
click a button; it does the work. No software to install on your laptop.

### 4a. Get the right connection string

In Supabase, go to **Project Settings** → **Database** → **Connection string**.

There are several tabs. You want **Session pooler** — _not_ Direct connection.

Direct connection only works over IPv6, which most machines (including GitHub's)
cannot use. It will simply hang with no useful error. Session pooler works
everywhere. This is the single most common thing to get stuck on.

Copy that string. Replace `[YOUR-PASSWORD]` with your database password.

**If you have already sent your password to me in a chat message, reset it
first:** Project Settings → Database → **Reset database password**. Anything
pasted into a conversation should be treated as no longer private. Generate a
new one, save it in your password manager, and use that in the string below.
Nothing is broken by resetting it.

### 4b. Store it in GitHub

1. Go to your repository on GitHub: **github.com/adityabagarka/QMSWorkflow**
2. **Settings** → in the left sidebar, **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `DATABASE_URL` — exactly that, capitals and underscore
5. Secret: paste the session pooler string from 4a
6. Click **Add secret**

GitHub encrypts this. Nobody, including me, can read it back out — it is only
decrypted inside a running job. This is why it goes here rather than into a
message.

### 4c. Press the button

1. On the repository, click the **Actions** tab
2. In the left sidebar, choose **Deploy to Supabase staging**
3. Click **Run workflow**, leave "Also import the guardrails workbook" ticked,
   and click the green **Run workflow** button
4. Wait two or three minutes, then click into the run to watch it

It will:

- create about 40 tables
- run 67 automated checks proving each of the six roles can see exactly the
  deals they should and nothing else
- load roughly 1,400 plans and their pricing from the guardrails workbook

A green tick means all three worked. A red cross means something failed — open
the run, copy what it says, and send it to me. I will fix it and you press the
button again.

### 4d. Sign in

Once it is green, sign in with **`aditya@bagarka.in`** — that address is set as
the first Super Admin, so you become one automatically. Everyone else who signs
in lands in the approval queue with no access until you approve them and give
them a role and a manager.

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

**The deploy job hangs on "Confirm the database is reachable".** You almost
certainly used the Direct connection string rather than the Session pooler one.
Go back to stage 4a and swap it.

**The deploy job says "password authentication failed".** The password in the
connection string does not match. If you reset it, rebuild the string with the
new password and update the GitHub secret.
