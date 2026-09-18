import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const classesRouter = Router();
classesRouter.use(requireAuth);

// List — any authenticated role at this center can read the class list.
classesRouter.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, t.full_name AS class_teacher_name
     FROM classes c
     LEFT JOIN teachers t ON t.id = c.class_teacher_id
     WHERE c.center_id = $1
     ORDER BY c.grade, c.stream`,
    [req.auth.centerId]
  );
  res.json(rows);
}));

classesRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, grade, stream, section, academicYear } = req.body;
  if (!name || !grade || !section) return res.status(400).json({ error: 'name, grade and section are required' });

  const { rows } = await query(
    `INSERT INTO classes (center_id, name, grade, stream, section, academic_year)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.auth.centerId, name, grade, stream || null, section, academicYear || null]
  );
  res.status(201).json(rows[0]);
}));

classesRouter.patch('/:id/class-teacher', requireRole('admin'), asyncHandler(async (req, res) => {
  const { teacherId } = req.body;
  // Ownership check: the class AND the teacher must both belong to this center,
  // otherwise an admin at Center A could point a class at a teacher from Center B.
  if (teacherId) {
    const t = await query(`SELECT id FROM teachers WHERE id = $1 AND center_id = $2`, [teacherId, req.auth.centerId]);
    if (!t.rows[0]) return res.status(404).json({ error: 'Teacher not found at this center' });
  }
  const { rows } = await query(
    `UPDATE classes SET class_teacher_id = $1 WHERE id = $2 AND center_id = $3 RETURNING *`,
    [teacherId || null, req.params.id, req.auth.centerId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Class not found' });
  res.json(rows[0]);
}));

classesRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM classes WHERE id = $1 AND center_id = $2`, [req.params.id, req.auth.centerId]);
  if (!rowCount) return res.status(404).json({ error: 'Class not found' });
  res.status(204).end();
}));
