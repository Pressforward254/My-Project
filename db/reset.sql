-- Full reset: drops every object this app owns, so db/schema.sql can be
-- reapplied cleanly regardless of what schema version was there before.
-- Safe to run any time you want to wipe and start over — it does NOT touch
-- the database or role itself, only the tables/types inside it.

DROP TABLE IF EXISTS edit_requests CASCADE;
DROP TABLE IF EXISTS remarks CASCADE;
DROP TABLE IF EXISTS marks CASCADE;
DROP TABLE IF EXISTS exams CASCADE;
DROP TABLE IF EXISTS grading_bands CASCADE;
DROP TABLE IF EXISTS teacher_subjects CASCADE;
DROP TABLE IF EXISTS class_teachers CASCADE;
DROP TABLE IF EXISTS teacher_logins CASCADE;
DROP TABLE IF EXISTS teacher_section_logins CASCADE; -- old name, in case it's still there
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS subjects CASCADE;
DROP TABLE IF EXISTS classes CASCADE;
DROP TABLE IF EXISTS teachers CASCADE;
DROP TABLE IF EXISTS admins CASCADE;
DROP TABLE IF EXISTS centers CASCADE;

DROP TYPE IF EXISTS edit_request_status CASCADE;
DROP TYPE IF EXISTS edit_request_type CASCADE;
DROP TYPE IF EXISTS section CASCADE;
