import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { hashPassword } from '../lib/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const studentsRouter = Router();
studentsRouter.use(requireAuth);

const DEFAULT_PASSWORD = 'Student@2026';

// Admin/teacher only — this is a full roster including parent contact info,
// so a student/parent token must never be able to call this (they'd see
// every other family's data, not just their own).
studentsRouter.get('/', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, school_id_number, full_name, class_id, status, password_changed,
            parent_name, parent_phone, parent_email
     FROM students WHERE center_id = $1 ORDER BY full_name`,
    [req.auth.centerId]
  );
  res.json(rows);
}));

// A student can only ever fetch their own record — id comes from their own
// token (req.auth.sub), never from a param, so there's nothing to guess.
studentsRouter.get('/me', requireRole('student'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.school_id_number, s.full_name, s.class_id, c.name AS class_name, c.section
     FROM students s LEFT JOIN classes c ON c.id = s.class_id
     WHERE s.id = $1 AND s.center_id = $2`,
    [req.auth.sub, req.auth.centerId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Student not found' });
  res.json(rows[0]);
}));

studentsRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { schoolIdNumber, fullName, classId, parentName, parentPhone, parentEmail } = req.body;
  if (!schoolIdNumber || !fullName) return res.status(400).json({ error: 'schoolIdNumber and fullName are required' });

  // School ID Number is unique ORG-WIDE (design doc Section 3) — the UNIQUE
  // constraint on students.school_id_number is what actually guarantees this
  // as MOHI grows past one center; this check just gives a friendlier error.
  const existing = await query(`SELECT id FROM students WHERE school_id_number = $1`, [schoolIdNumber.trim()]);
  if (existing.rows[0]) return res.status(409).json({ error: `School ID "${schoolIdNumber}" is already in use` });

  if (classId) {
    const cls = await query(`SELECT id FROM classes WHERE id = $1 AND center_id = $2`, [classId, req.auth.centerId]);
    if (!cls.rows[0]) return res.status(404).json({ error: 'Class not found at this center' });
  }

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const { rows } = await query(
    `INSERT INTO students (school_id_number, center_id, full_name, class_id, password_hash, parent_name, parent_phone, parent_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, school_id_number, full_name, class_id`,
    [schoolIdNumber.trim(), req.auth.centerId, fullName, classId || null, passwordHash, parentName || null, parentPhone || null, parentEmail || null]
  );
  res.status(201).json(rows[0]);
}));

// Bulk add via CSV — columns: Full Name, School ID, Class (class matched by
// name at this center; unmatched class name still creates the student, just
// unassigned). Client sends the raw CSV text; parsing happens here so the
// validation rules live in one place.
studentsRouter.post('/bulk', requireRole('admin'), asyncHandler(async (req, res) => {
  const { csv } = req.body;
  if (!csv || !csv.trim()) return res.status(400).json({ error: 'csv text is required' });

  const classes = await query(`SELECT id, name FROM classes WHERE center_id = $1`, [req.auth.centerId]);
  const classByName = new Map(classes.rows.map(c => [c.name.toLowerCase(), c.id]));

  const lines = csv.trim().split(/\r?\n/).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
  const start = /name/i.test(lines[0]?.[0] || '') ? 1 : 0;
  let added = 0;
  const skipped = [];
  const defaultPasswordHash = await hashPassword(DEFAULT_PASSWORD);

  for (let i = start; i < lines.length; i++) {
    const [name, idRaw, className] = lines[i];
    const schoolId = (idRaw || '').trim();
    if (!name || !schoolId) { skipped.push(`Row ${i + 1}: missing name or School ID`); continue; }
    const dupe = await query(`SELECT id FROM students WHERE school_id_number = $1`, [schoolId]);
    if (dupe.rows[0]) { skipped.push(`Row ${i + 1}: School ID "${schoolId}" already in use`); continue; }
    const classId = className ? classByName.get(className.trim().toLowerCase()) : null;
    if (className && !classId) skipped.push(`Row ${i + 1}: class "${className}" not found — added with no class`);
    await query(
      `INSERT INTO students (school_id_number, center_id, full_name, class_id, password_hash) VALUES ($1,$2,$3,$4,$5)`,
      [schoolId, req.auth.centerId, name.trim(), classId || null, defaultPasswordHash]
    );
    added++;
  }
  res.json({ added, skipped });
}));

// Editing a student's name or School ID does NOT happen here — per the
// approval workflow, those go through POST /edit-requests instead. This
// endpoint only allows the non-sensitive fields (class, parent contact).
studentsRouter.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { classId, parentName, parentPhone, parentEmail } = req.body;
  const { rows } = await query(
    `UPDATE students SET
       class_id = COALESCE($1, class_id),
       parent_name = $2, parent_phone = $3, parent_email = $4
     WHERE id = $5 AND center_id = $6
     RETURNING id, school_id_number, full_name, class_id, parent_name, parent_phone, parent_email`,
    [classId || null, parentName || null, parentPhone || null, parentEmail || null, req.params.id, req.auth.centerId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Student not found' });
  res.json(rows[0]);
}));

studentsRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM students WHERE id = $1 AND center_id = $2`, [req.params.id, req.auth.centerId]);
  if (!rowCount) return res.status(404).json({ error: 'Student not found' });
  res.status(204).end();
}));
