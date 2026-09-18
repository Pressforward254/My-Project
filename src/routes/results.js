import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { pointsToLevel } from '../lib/grading.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const resultsRouter = Router();
resultsRouter.use(requireAuth);

// Computes, for every student in a class/exam: per-subject marks, mean points,
// mean grade, and class position — same logic as computeClassResults() in the
// prototype, just running as a real query instead of client-side JS.
resultsRouter.get('/', asyncHandler(async (req, res) => {
  const { examId, classId } = req.query;
  if (!examId || !classId) return res.status(400).json({ error: 'examId and classId are required' });

  const cls = await query(`SELECT id, section FROM classes WHERE id = $1 AND center_id = $2`, [classId, req.auth.centerId]);
  if (!cls.rows[0]) return res.status(404).json({ error: 'Class not found at this center' });

  const subjects = await query(
    `SELECT id, name FROM subjects WHERE center_id = $1 AND (section IS NULL OR section = $2) ORDER BY name`,
    [req.auth.centerId, cls.rows[0].section]
  );

  const students = await query(
    `SELECT id, full_name FROM students WHERE class_id = $1 AND center_id = $2 ORDER BY full_name`,
    [classId, req.auth.centerId]
  );

  const marks = await query(
    `SELECT student_id, subject_id, sublevel, points, percent FROM marks
     WHERE exam_id = $1 AND student_id = ANY($2::uuid[])`,
    [examId, students.rows.map((s) => s.id)]
  );
  const marksByStudent = {};
  for (const m of marks.rows) {
    (marksByStudent[m.student_id] ??= {})[m.subject_id] = m;
  }

  const rows = students.rows.map((s) => {
    const subjectMarks = marksByStudent[s.id] || {};
    const graded = Object.values(subjectMarks);
    const total = graded.reduce((sum, m) => sum + m.points, 0);
    const meanPoints = graded.length ? total / graded.length : null;
    return {
      student: s,
      subjects: subjects.rows.map((sub) => ({ subject: sub, mark: subjectMarks[sub.id] || null })),
      subjectsGraded: graded.length,
      totalPoints: total,
      meanPoints,
      meanLevel: meanPoints !== null ? pointsToLevel(meanPoints) : null,
    };
  });

  const ranked = rows.filter((r) => r.subjectsGraded > 0).sort((a, b) => b.totalPoints - a.totalPoints);
  ranked.forEach((r, i) => { r.position = i + 1; r.outOf = ranked.length; });
  rows.forEach((r) => { if (r.subjectsGraded === 0) { r.position = null; r.outOf = ranked.length; } });

  rows.sort((a, b) => (a.position || 999) - (b.position || 999) || a.student.full_name.localeCompare(b.student.full_name));
  res.json(rows);
}));
