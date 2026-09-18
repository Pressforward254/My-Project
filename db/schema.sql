-- MOHI Results & Analytics — database schema
-- Mirrors MOHI-Results-System-Design.md Section 6.
--
-- The core guarantee from the design doc — "one center can never see another's
-- data, enforced in the backend, not just the UI" — is implemented two ways here:
--   1. Every center-scoped table carries a NOT NULL center_id foreign key.
--   2. Every application query (see src/lib/db.js) is required to filter by the
--      center_id taken from the caller's JWT, never from client input.
-- This schema alone doesn't enforce #2 — that's application code — but it makes
-- the shape of the data correct so #2 is straightforward and hard to get wrong.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

CREATE TYPE section AS ENUM ('PRIMARY', 'JUNIOR', 'SENIOR');
CREATE TYPE edit_request_type AS ENUM ('STUDENT_NAME', 'STUDENT_ID', 'MARK');
CREATE TYPE edit_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- ---------- ORGANIZATION LAYER ----------

CREATE TABLE centers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,                 -- e.g. "Ndovoini Center"
  center_code   text NOT NULL UNIQUE,           -- e.g. "MOHI-NDV"
  location      text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- PEOPLE ----------

CREATE TABLE admins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id      uuid REFERENCES centers(id) ON DELETE CASCADE, -- NULL for IT support (org-wide, not tied to one center)
  role           text NOT NULL DEFAULT 'school_admin' CHECK (role IN ('school_admin', 'it_support')),
  full_name      text NOT NULL,
  email          text NOT NULL UNIQUE,          -- individual per-admin login
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- a school_admin must belong to exactly one center; it_support belongs to none (picks one per session instead)
  CHECK ( (role = 'school_admin' AND center_id IS NOT NULL) OR (role = 'it_support' AND center_id IS NULL) )
);
CREATE INDEX idx_admins_center ON admins(center_id);

CREATE TABLE teachers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  phone       text,
  bio         text,
  section     section NOT NULL,                 -- which shared per-section login they sign in under
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_teachers_center ON teachers(center_id);

-- ONE shared teacher login per center (e.g. babadogo@mohiafrica.org) covering
-- every section — individual teachers still pick their own name after this
-- (see /auth/teacher/select), and each teacher's own `section` column above
-- is what scopes their classes/subjects, not the login itself.
CREATE TABLE teacher_logins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id      uuid NOT NULL UNIQUE REFERENCES centers(id) ON DELETE CASCADE,
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL
);
CREATE INDEX idx_tl_center ON teacher_logins(center_id);

-- ---------- SCHOOL STRUCTURE ----------

CREATE TABLE classes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id         uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name              text NOT NULL,              -- full display name, e.g. "Grade 8 Green"
  grade             text NOT NULL,               -- e.g. "Grade 8"
  stream            text,                        -- e.g. "Green"
  section           section NOT NULL,
  academic_year     text,
  class_teacher_id  uuid REFERENCES teachers(id) ON DELETE SET NULL,
  UNIQUE (center_id, name)
);
CREATE INDEX idx_classes_center ON classes(center_id);

CREATE TABLE subjects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name        text NOT NULL,
  code        text,
  section     section,                          -- null = taught across all sections
  UNIQUE (center_id, name)
);
CREATE INDEX idx_subjects_center ON subjects(center_id);

CREATE TABLE class_teachers (                    -- which classes a teacher is assigned to
  class_id    uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id  uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, teacher_id)
);

CREATE TABLE teacher_subjects (                  -- which subjects a teacher teaches
  teacher_id  uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, subject_id)
);

CREATE TABLE students (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id_number  text NOT NULL UNIQUE,        -- the login identifier, unique ORG-WIDE (not just per-center)
  center_id         uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  full_name         text NOT NULL,
  class_id          uuid REFERENCES classes(id) ON DELETE SET NULL,
  date_of_birth     date,
  gender            text,
  enrollment_date   date NOT NULL DEFAULT current_date,
  status            text NOT NULL DEFAULT 'active', -- active | left

  password_hash     text NOT NULL,
  password_changed  boolean NOT NULL DEFAULT false,

  parent_name       text,
  parent_phone      text,
  parent_email      text
);
CREATE INDEX idx_students_center ON students(center_id);
CREATE INDEX idx_students_class ON students(class_id);

-- ---------- GRADING ----------

CREATE TABLE grading_bands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid REFERENCES centers(id) ON DELETE CASCADE, -- null = org-wide default (standard CBC scale)
  sublevel    text NOT NULL,                     -- EE1, EE2, ME1, ME2, AE1, AE2, BE1, BE2
  level       text NOT NULL,                     -- EE, ME, AE, BE
  points      int NOT NULL,                      -- 8..1
  pct_min     int NOT NULL,
  pct_max     int NOT NULL
);

-- ---------- EXAMS & RESULTS ----------

CREATE TABLE exams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name          text NOT NULL,                   -- e.g. "Term 2 Mid-Term 2026"
  term          text,
  academic_year text,
  opens_on      text,                            -- next term's opening date, shown on report card
  closes_on     text,                            -- this term's closing date, shown on report card
  newsletter    text,                            -- short note shown on report card
  is_published  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exams_center ON exams(center_id);

CREATE TABLE marks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id        uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id     uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  sublevel       text NOT NULL,                  -- EE1..BE2
  points         int NOT NULL,                   -- 8..1, derived from sublevel
  percent        numeric(5,2),                   -- optional raw percentage score
  entered_by_id  uuid REFERENCES teachers(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id, subject_id)
);
CREATE INDEX idx_marks_exam ON marks(exam_id);
CREATE INDEX idx_marks_student ON marks(student_id);

CREATE TABLE remarks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id     uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  text        text NOT NULL,
  teacher_id  uuid REFERENCES teachers(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);

-- ---------- APPROVAL WORKFLOW ----------

CREATE TABLE edit_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id                uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  type                     edit_request_type NOT NULL,
  label                    text NOT NULL,
  old_value                text NOT NULL,
  new_value                text NOT NULL,
  status                   edit_request_status NOT NULL DEFAULT 'PENDING',
  requested_by_teacher_id  uuid REFERENCES teachers(id) ON DELETE SET NULL,
  student_id               uuid REFERENCES students(id) ON DELETE CASCADE,
  extra_json               jsonb,               -- for MARK requests: {examId, studentId, subjectId, percent}
  resolved_by_admin_id     uuid REFERENCES admins(id) ON DELETE SET NULL,
  requested_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at              timestamptz
);
CREATE INDEX idx_edit_requests_center ON edit_requests(center_id);
CREATE INDEX idx_edit_requests_status ON edit_requests(status);
