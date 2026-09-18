import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const remarksRouter = Router();
remarksRouter.use(requireAuth);

// Existing remarks for a class/exam, so the teacher's comment grid can be
// pre-filled instead of always starting blank.
remarksRouter.get('/', requireRole('teacher', 'admin'), asyncHandler(async (req, res) => {
  const { examId, classId } = req.query;
  if (!examId || !classId) return res.status(400).json({ error: 'examId and classId are required' });

  const cls = await query(`SELECT id FROM classes WHERE id = $1 AND center_id = $2`, [classId, req.auth.centerId]);
  if (!cls.rows[0]) return res.status(404).json({ error: 'Class not found at this center' });

  const { rows } = await query(
    `SELECT r.student_id, r.text FROM remarks r
     JOIN students s ON s.id = r.student_id
     WHERE r.exam_id = $1 AND s.class_id = $2`,
    [examId, classId]
  );
  res.json(rows);
}));

remarksRouter.put('/', requireRole('teacher', 'admin'), asyncHandler(async (req, res) => {
  const { examId, studentId, text } = req.body;
  if (!examId || !studentId) return res.status(400).json({ error: 'examId and studentId are required' });

  const student = await query(`SELECT id FROM students WHERE id = $1 AND center_id = $2`, [studentId, req.auth.centerId]);
  if (!student.rows[0]) return res.status(404).json({ error: 'Student not found at this center' });
  const exam = await query(`SELECT id FROM exams WHERE id = $1 AND center_id = $2`, [examId, req.auth.centerId]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found at this center' });

  const trimmed = (text || '').trim();
  if (!trimmed) {
    await query(`DELETE FROM remarks WHERE exam_id = $1 AND student_id = $2`, [examId, studentId]);
    return res.json({ deleted: true });
  }
  const teacherId = req.auth.role === 'teacher' ? req.auth.sub : null;
  const { rows } = await query(
    `INSERT INTO remarks (exam_id, student_id, text, teacher_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (exam_id, student_id) DO UPDATE SET text = $3, teacher_id = $4, updated_at = now()
     RETURNING *`,
    [examId, studentId, trimmed, teacherId]
  );
  res.json(rows[0]);
}));
