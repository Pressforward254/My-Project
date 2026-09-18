import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const subjectsRouter = Router();
subjectsRouter.use(requireAuth);

subjectsRouter.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM subjects WHERE center_id = $1 ORDER BY name`,
    [req.auth.centerId]
  );
  res.json(rows);
}));

subjectsRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, code, section } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { rows } = await query(
    `INSERT INTO subjects (center_id, name, code, section) VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.auth.centerId, name, code || null, section || null]
  );
  res.status(201).json(rows[0]);
}));

subjectsRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM subjects WHERE id = $1 AND center_id = $2`, [req.params.id, req.auth.centerId]);
  if (!rowCount) return res.status(404).json({ error: 'Subject not found' });
  res.status(204).end();
}));
