import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const examsRouter = Router();
examsRouter.use(requireAuth);

// Students/parents only ever see published exams — enforced here, not just in the UI:
// non-admin, non-teacher callers get is_published = true forced onto the filter.
examsRouter.get('/', asyncHandler(async (req, res) => {
  const onlyPublished = req.auth.role === 'student';
  const { rows } = await query(
    `SELECT * FROM exams WHERE center_id = $1 ${onlyPublished ? 'AND is_published = true' : ''} ORDER BY created_at`,
    [req.auth.centerId]
  );
  res.json(rows);
}));

examsRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, term, academicYear, opensOn, closesOn, newsletter } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { rows } = await query(
    `INSERT INTO exams (center_id, name, term, academic_year, opens_on, closes_on, newsletter)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [req.auth.centerId, name, term || null, academicYear || null, opensOn || null, closesOn || null, newsletter || null]
  );
  res.status(201).json(rows[0]);
}));

examsRouter.patch('/:id/publish', requireRole('admin'), asyncHandler(async (req, res) => {
  const { isPublished } = req.body;
  const { rows } = await query(
    `UPDATE exams SET is_published = $1 WHERE id = $2 AND center_id = $3 RETURNING *`,
    [!!isPublished, req.params.id, req.auth.centerId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Exam not found' });
  res.json(rows[0]);
}));

examsRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM exams WHERE id = $1 AND center_id = $2`, [req.params.id, req.auth.centerId]);
  if (!rowCount) return res.status(404).json({ error: 'Exam not found' });
  res.status(204).end();
}));
