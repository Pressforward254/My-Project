import { Router } from 'express';
import { query, pool } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { SUBLEVEL_POINTS } from '../lib/grading.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const editRequestsRouter = Router();
editRequestsRouter.use(requireAuth);

// Student/admin submits a name or School ID change — queued, never applied directly.
editRequestsRouter.post('/student-edit', requireRole('admin'), asyncHandler(async (req, res) => {
  const { studentId, field, newValue } = req.body; // field: 'name' | 'schoolId'
  if (!studentId || !field || !newValue) return res.status(400).json({ error: 'studentId, field and newValue are required' });
  if (!['name', 'schoolId'].includes(field)) return res.status(400).json({ error: 'field must be "name" or "schoolId"' });

  const student = await query(`SELECT id, full_name, school_id_number FROM students WHERE id = $1 AND center_id = $2`, [studentId, req.auth.centerId]);
  if (!student.rows[0]) return res.status(404).json({ error: 'Student not found' });

  if (field === 'schoolId') {
    const dupe = await query(`SELECT id FROM students WHERE school_id_number = $1 AND id != $2`, [newValue.trim(), studentId]);
    if (dupe.rows[0]) return res.status(409).json({ error: `School ID "${newValue}" is already in use` });
  }

  const type = field === 'name' ? 'STUDENT_NAME' : 'STUDENT_ID';
  const oldValue = field === 'name' ? student.rows[0].full_name : student.rows[0].school_id_number;
  const label = field === 'name' ? `Name — ${student.rows[0].full_name}` : `School ID — ${student.rows[0].full_name}`;

  const { rows } = await query(
    `INSERT INTO edit_requests (center_id, type, label, old_value, new_value, student_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.auth.centerId, type, label, oldValue, newValue.trim(), studentId]
  );
  res.status(201).json(rows[0]);
}));

editRequestsRouter.get('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { status } = req.query; // pending | approved | rejected | (omit for all)
  const { rows } = await query(
    `SELECT * FROM edit_requests WHERE center_id = $1 ${status ? 'AND status = $2' : ''} ORDER BY requested_at DESC`,
    status ? [req.auth.centerId, status.toUpperCase()] : [req.auth.centerId]
  );
  res.json(rows);
}));

editRequestsRouter.post('/:id/approve', requireRole('admin'), asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM edit_requests WHERE id = $1 AND center_id = $2 AND status = 'PENDING' FOR UPDATE`,
      [req.params.id, req.auth.centerId]
    );
    const reqRow = rows[0];
    if (!reqRow) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pending request not found' }); }

    if (reqRow.type === 'STUDENT_NAME') {
      await client.query(`UPDATE students SET full_name = $1 WHERE id = $2`, [reqRow.new_value, reqRow.student_id]);
    } else if (reqRow.type === 'STUDENT_ID') {
      await client.query(`UPDATE students SET school_id_number = $1 WHERE id = $2`, [reqRow.new_value, reqRow.student_id]);
    } else if (reqRow.type === 'MARK') {
      const extra = reqRow.extra_json;
      if (extra.clear) {
        await client.query(`DELETE FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3`, [extra.examId, extra.studentId, extra.subjectId]);
      } else {
        const points = SUBLEVEL_POINTS[reqRow.new_value];
        await client.query(
          `INSERT INTO marks (exam_id, student_id, subject_id, sublevel, points, percent, entered_by_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (exam_id, student_id, subject_id)
           DO UPDATE SET sublevel = $4, points = $5, percent = $6, updated_at = now()`,
          [extra.examId, extra.studentId, extra.subjectId, reqRow.new_value, points, extra.percent ?? null, reqRow.requested_by_teacher_id]
        );
      }
    }

    await client.query(
      `UPDATE edit_requests SET status = 'APPROVED', resolved_by_admin_id = $1, resolved_at = now() WHERE id = $2`,
      [req.auth.sub, reqRow.id]
    );
    await client.query('COMMIT');
    res.json({ approved: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

editRequestsRouter.post('/:id/reject', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE edit_requests SET status = 'REJECTED', resolved_by_admin_id = $1, resolved_at = now()
     WHERE id = $2 AND center_id = $3 AND status = 'PENDING' RETURNING *`,
    [req.auth.sub, req.params.id, req.auth.centerId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Pending request not found' });
  res.json({ rejected: true });
}));
