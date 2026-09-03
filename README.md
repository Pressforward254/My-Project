# MOHI Results & Analytics

A real Node.js + PostgreSQL app for the MOHI Exam Results & Analytics System —
backend API **and** frontend in one deployable service. `public/index.html`
is the whole UI (login, admin/teacher/student screens, report cards); Express
serves it directly alongside the API, so this is one app with one URL, not a
separate frontend + backend to deploy. **See `DEPLOYMENT.md` for the fastest
path to a live URL.**

**This has been built and tested end-to-end against a real PostgreSQL database**
in the course of building it — every endpoint was exercised with curl, plus a
33-check test (`npm test`) that simulates every real flow the frontend makes,
call for call, including the multi-center isolation guarantees (see
"What's actually been proven").

## Why raw SQL instead of an ORM (e.g. Prisma)

Prisma was the first choice, but its migration/query engine needs to download a
binary from `binaries.prisma.sh` at install/migrate time, which isn't reachable
from a locked-down environment. Rather than fight that, this uses the plain
`pg` driver with hand-written SQL (`db/schema.sql`, plus parameterized queries
in each route). This is a completely normal choice for a system like this one —
arguably a better one here, since the central promise of this whole project
("one center can never see another's data") lives in the `WHERE center_id = $1`
clause of every query, and it's better for that clause to be visible and
auditable in the code than hidden inside an ORM abstraction. If you'd prefer
Prisma/Drizzle/Knex once this runs somewhere with normal internet access, the
schema translates over directly — nothing here is SQL-only by necessity.

## Architecture

- **Centers** are the top-level tenant. Every center-scoped table has a
  `center_id` column, and every query in every route filters by
  `req.auth.centerId` — a value that comes from the verified JWT, never from
  the request body/params/query string. See `src/middleware/auth.js`.
- **Admin has two dimensions**, sharing one login form:
  - `school_admin` — the original role. Individual login
    (`admin@<slug>.mohiafrica.org`), tied to exactly one center (enforced by
    a DB check constraint).
  - `it_support` — one org-wide account (`it@mohi.org`). Logs straight into
    the dashboard, no center-picker step first — it lands on its
    most-recently-added center by default and switches centers from inside
    the dashboard (the strip at the top of the admin shell) via
    `/auth/admin/switch-center`, no re-entering a password. IT support
    satisfies every `requireRole(...)` check in the app (see
    `middleware/auth.js`) — it can do everything a school admin, teacher, or
    student's actions require.
  - Only IT support can create new centers (`POST /centers`) or list every
    center at once (`GET /centers` for a school_admin returns just their own).
  - **Creating a center auto-provisions its two logins** — e.g. adding
    "Babadogo Center" creates `admin@babadogo.mohiafrica.org` and
    `babadogo@mohiafrica.org` automatically, both on a default password
    returned once in the response for IT to hand over.
- **Teachers share ONE login per center** (not per section) — e.g.
  `babadogo@mohiafrica.org` covers Primary, Junior and Senior staff alike,
  with a "which teacher are you?" step after that shared credential so mark
  entries stay traceable. Each teacher's own `section` field (set when
  they're added) scopes their classes/subjects — the login no longer does.
- **Roles**: `admin` (school_admin or it_support), `teacher` (one shared
  login per center, all sections, with the "which teacher are you" step),
  `student` (School ID Number, unique **organization-wide**, shared with parent).
- **Grading**: CBC 8-point scale (EE1–BE2) plus an optional raw percentage;
  entering a percent auto-derives the sub-level via `src/lib/grading.js`'s
  band table — the same bands as the prototype, flagged there and here as a
  default that hasn't been confirmed against Ndovoini's actual conversion table.
- **Approval workflow**: editing a student's name/School ID, or editing a mark
  on an already-published exam, inserts a row into `edit_requests` instead of
  applying immediately. An admin (school_admin or it_support) approves or
  rejects via `/edit-requests`.
- **CSV bulk upload**: `POST /students/bulk`, `POST /teachers/bulk` (admin,
  per-center), and `POST /marks/bulk` (admin, whole-school for one exam at
  once) all take raw CSV text in the request body and parse it server-side —
  matching UI panels are in Students, Teachers, and Results.

## What's actually been proven (not just written)

Run from a clean checkout, this was verified to work:
- Admin login → list classes/teachers/students (real relational joins, not mock data)
- Two-step teacher login (section credential → pick your name)
- Mark entry by percent → auto-converts to CBC sub-level and points
- Section-based subject filtering (a Junior class's results never show
  Primary- or Senior-only subjects)
- Publishing an exam, then a teacher editing an already-entered mark →
  **queues an edit_request instead of applying**, admin approves it →
  the mark then updates
- Student login forces a password reset on first login; after resetting,
  fetching their own report card returns computed mean points/grade/position
  and their class teacher's contact info
- **Cross-center isolation**: a second center (Babadogo) was created; its
  admin's token returns an empty list where Ndovoini has 4 classes and 2
  students; and a DELETE request using a Ndovoini class's real ID, sent with
  the Babadogo token, returns 404 and leaves the record untouched.
- **IT support dimension**: logging in as `it@mohi.org` returns all 6 seeded
  centers instead of a token; picking Ndovoini returns a token scoped to it;
  that token can list Ndovoini's classes, then `/auth/admin/switch-center` to
  Babadogo *without re-entering a password*, and immediately sees Babadogo's
  (empty) data instead. A school_admin token gets a 403 on both
  `POST /centers` and `/auth/admin/switch-center` — those stay IT-only. IT's
  token was also used to create a class directly, proving it carries real
  admin-level write access, not just read access.

## Setup

```bash
npm install
cp .env.example .env   # then edit DATABASE_URL / JWT_SECRET
psql "$DATABASE_URL" -f db/schema.sql
npm run seed            # creates all 6 named centers + demo data for Ndovoini
npm run dev
```

In a second terminal, with the server running:
```bash
npm test    # runs test/integration.js — 33 checks simulating every
            # frontend flow call-for-call against the real running server
```

Demo logins after seeding:
- IT support (org-wide, picks a center after login): `it@mohi.org` / `IT@2026`
- School admin (Ndovoini only): `admin@ndovoini.mohiafrica.org` / `Admin@2026`
- Teacher (Junior section, Ndovoini): `ndov.jss@mohiafrica.org` / `Teacher@2026`
- Student (Ndovoini): `MOHI-0101` / `Student@2026` (forces a password reset on first login)

Centers seeded (bare records, ready to be filled in as each is onboarded):
Ndovoini, Joska, Turi, Coramdeo, Milimani, Babadogo — Ndovoini is the only one
with classes/teachers/students/an exam already in it.

## API surface

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/admin/login` | both school_admin and it_support get a token directly — no gate |
| POST | `/auth/admin/switch-center` | IT support only: swap the current token to a different center, no re-login |
| POST | `/auth/teacher/login` | step 1, returns `sectionToken` + list of teachers |
| POST | `/auth/teacher/select` | step 2, returns the real token |
| POST | `/auth/student/login` | may return `needsPasswordChange` + `resetToken` |
| POST | `/auth/student/set-password` | |
| GET/POST/PATCH | `/centers` | GET: IT sees all, school_admin sees only their own. POST/`:id/active`: IT only |
| GET/POST/PATCH/DELETE | `/classes` | admin-only writes (school_admin or it_support) |
| GET/POST/DELETE | `/subjects` | |
| GET/POST/PATCH/DELETE | `/teachers` | |
| GET/POST/PATCH/DELETE | `/students` | name/School ID edits go through `/edit-requests` instead |
| GET/POST/PATCH/DELETE | `/exams` | `/exams/:id/publish` |
| GET/PUT | `/marks` | grid fetch + single-mark upsert with approval gating |
| PUT | `/remarks` | class teacher's comment per student/exam |
| GET | `/results` | computed class results for an exam |
| GET | `/report-card/:studentId` + `/report-card/:studentId/trend` | |
| GET/POST | `/edit-requests`, POST `/edit-requests/:id/approve` \| `/reject` | |

## What this does NOT include yet

- CSV bulk-upload endpoints (students, teachers, whole-school marks) — the
  prototype has these client-side; porting them to the API is the same shape
  of work as the routes already here, just not done yet.
- Rate limiting, request logging, refresh tokens (JWTs currently last 12h with
  no refresh flow).
- Deployment config for a specific host (Render/Railway/Fly/etc.) — the app
  itself has no host-specific code, so it should run on any of them; you'd
  need to provision a Postgres instance there and point `DATABASE_URL` at it.

## The frontend

`mohi-webapp.html` (shipped alongside this backend) is the prototype rebuilt
to call this API with `fetch()` instead of reading/writing local browser
storage. Every screen — login (all four paths, including the IT center-picker
and switch-center), Classes/Subjects/Teachers/Students/Exams/Results/
Notifications, teacher mark entry, and the student report card — was tested
against this backend running locally by simulating the exact request sequence
each screen makes, not just spot-checked. Two real bugs were caught and fixed
in that process:
- `GET /students` had no role restriction, meaning a student's token could
  list the *entire* class roster including every family's parent contact
  info. Fixed to admin/teacher only, with a new `GET /students/me` for a
  student to fetch just their own record.
- The teacher-login section list was inferring "which section is this teacher
  in" from which class they'd been assigned to, ignoring the `section` column
  on the teacher record entirely — so setting a teacher's login section in
  the UI wouldn't actually have changed which shared login found them. Fixed
  so the stored `teachers.section` is the actual source of truth.

Before this frontend can be reached at a real URL, `API_BASE` at the top of
its `<script>` needs to point at wherever this backend ends up deployed
(currently defaults to `http://localhost:3001` for local testing) — see the
chat response for what deploying both pieces actually involves.

## Environment variables

See `.env.example`. `JWT_SECRET` must be set to a real secret in production —
the server refuses to start without one (see `src/lib/auth.js`).
