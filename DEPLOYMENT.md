# Getting this live — fast path

The frontend now lives inside the backend (`public/index.html`), so this is
**one app, one deploy, one URL** — no separate frontend host, no CORS setup.
A `render.yaml` blueprint is included that provisions the database and the
app together, with the database connection and a secret key wired up
automatically. This is the fastest real path I can hand you without an
account of my own.

## Do this now (roughly 15 minutes, most of it waiting on Render)

**1. Get the code onto GitHub** (2 min if you already have an account):
   - Go to github.com → **New repository** → name it anything (e.g. `mohi-results`) → Create.
   - On the new repo's page, use **"Add file" → "Upload files"**, drag in
     everything from the unzipped `mohi-backend` folder, commit.
   - No git command line needed — the web upload works fine for this.

**2. Deploy on Render** (5 min setup + a few min build time):
   - Go to [render.com](https://render.com) → sign up/log in (GitHub login is fastest).
   - **New +** → **Blueprint** → connect the GitHub repo you just made.
   - Render reads `render.yaml` automatically and shows you: one **Web Service**
     and one **PostgreSQL database**, both pre-configured. Click **Apply**.
   - Wait for both to go green ("Live" / "Available"). Render gives you a URL
     like `https://mohi-results-xyz.onrender.com` — **that's your site.**

**3. Load the database schema + demo data** (2 min, one-time):
   - On the web service's page in Render, open the **Shell** tab (top right).
   - Run:
     ```
     psql "$DATABASE_URL" -f db/schema.sql
     npm run seed
     ```
   - That's it — visit your Render URL, log in with the seeded demo accounts
     (see below), and start replacing the demo data with Ndovoini's real
     classes/teachers/students through the app itself (Admin → Classes/
     Teachers/Students — no more shell commands needed after this).

**4. Open it**: `https://mohi-results-xyz.onrender.com` in Chrome. Log in as
   admin, start entering real classes/teachers/students, and you're usable
   today. Add the custom domain (`results.mohiafrica.org`) whenever whoever
   manages that DNS is available — it's a five-minute change you can do
   *after* today's deadline, it doesn't block going live right now.

## Demo logins (delete/change these once real data is in)

- IT support: `it@mohi.org` / `IT@2026` (picks a center after login)
- School admin: `admin@ndovoini.mohiafrica.org` / `Admin@2026`
- Teacher (Junior): `ndov.jss@mohiafrica.org` / `Teacher@2026`
- Student: `MOHI-0101` / `Student@2026` (forces a password reset)

## If something doesn't come up green on Render

- **Web service fails to build**: open its **Logs** tab, the error is almost
  always a missing env var — check `DATABASE_URL` and `JWT_SECRET` both show
  under its **Environment** tab (the blueprint should have added them
  automatically).
- **"relation does not exist" errors when using the app**: step 3's
  `psql ... -f db/schema.sql` didn't run or failed — rerun it from the Shell tab.
- **Free tier sleeps** after inactivity and takes ~30-60s to wake on the next
  visit — expected on the free plan, not a bug. Upgrade the web service's
  plan (a few dollars/month) once this is being used for real, to remove that.

## What NOT to worry about today

- Custom domain, CORS tightening, rate limiting — none of these block going
  live, they're all polish for once today's deadline has passed.
- The CSV bulk-upload screens from the earlier prototype aren't wired up in
  this version yet — add classes/teachers/students one at a time through the
  app for now; bulk upload can come later.

## How people should find it (not Google)

`public/index.html`'s `<head>` already has
`<meta name="robots" content="noindex, nofollow">`, and `public/robots.txt`
tells crawlers to skip the whole site — both deploy automatically as part of
this same app. Share the Render URL (or the custom domain once it's ready)
directly with centers/parents/teachers — via `portal.mohiafrica.org`, SMS, or
printed on the report card — rather than relying on search.
