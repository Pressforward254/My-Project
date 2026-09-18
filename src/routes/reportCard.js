import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { pointsToLevel } from '../lib/grading.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const reportCardRouter = Router();
reportCardRouter.use(requireAuth);

async function computeStudentExam(centerId, studentId, examId) {
  const student = await query(
    `SELECT s.*, c.name AS class_name, c.section, c.class_teacher_id
     FROM students s LEFT JOIN classes c ON c.id = s.class_id
     WHERE s.id = $1 AND s.center_id = $2`,
    [studentId, centerId]
  );
  if (!student.rows[0]) return null;
  const s = student.rows[0];

  const subjects = await query(
    `SELECT id, name FROM subjects WHERE center_id = $1 AND (section IS NULL OR section = $2) ORDER BY name`,
    [centerId, s.section]
  );
  const classmateTotals = await query(
    `SELECT student_id, SUM(points) AS total FROM marks
     WHERE exam_id = $1 AND student_id IN (SELECT id FROM students WHERE class_id = $2)
     GROUP BY student_id`,
    [examId, s.class_id]
  );
  const marks = await query(`SELECT subject_id, sublevel, points, percent FROM marks WHERE exam_id = $1 AND student_id = $2`, [examId, studentId]);
  const marksBySubject = Object.fromEntries(marks.rows.map((m) => [m.subject_id, m]));

  const graded = marks.rows;
  const meanPoints = graded.length ? graded.reduce((a, m) => a + m.points, 0) / graded.length : null;

  const ranked = classmateTotals.rows.map((r) => Number(r.total)).sort((a, b) => b - a);
  const myTotal = graded.reduce((a, m) => a + m.points, 0);
  const position = graded.length ? ranked.indexOf(myTotal) + 1 : null;

  const remark = await query(`SELECT text FROM remarks WHERE exam_id = $1 AND student_id = $2`, [examId, studentId]);
  const classTeacher = s.class_teacher_id
    ? (await query(`SELECT id, full_name, phone, bio FROM teachers WHERE id = $1`, [s.class_teacher_id])).rows[0]
    : null;

  return {
    student: { id: s.id, name: s.full_name, className: s.class_name, section: s.section, parentName: s.parent_name, parentPhone: s.parent_phone, parentEmail: s.parent_email },
    subjects: subjects.rows.map((sub) => ({ subject: sub, mark: marksBySubject[sub.id] || null })),
    meanPoints, meanLevel: meanPoints !== null ? pointsToLevel(meanPoints) : null,
    position, outOf: ranked.length,
    subjectsGraded: graded.length,
    remark: remark.rows[0]?.text || null,
    classTeacher,
  };
}

// One exam's full report card.
reportCardRouter.get('/:studentId', asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { examId } = req.query;
  if (req.auth.role === 'student' && req.auth.sub !== studentId) {
    return res.status(403).json({ error: "You can only view your own report card" });
  }
  if (!examId) return res.status(400).json({ error: 'examId is required' });

  const exam = await query(`SELECT * FROM exams WHERE id = $1 AND center_id = $2`, [examId, req.auth.centerId]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found' });
  if (!exam.rows[0].is_published && req.auth.role === 'student') {
    return res.status(403).json({ error: 'This exam has not been published yet' });
  }

  const data = await computeStudentExam(req.auth.centerId, studentId, examId);
  if (!data) return res.status(404).json({ error: 'Student not found' });
  res.json({ exam: exam.rows[0], ...data });
}));

// Term-over-term trend across every published exam the student has marks for.
reportCardRouter.get('/:studentId/trend', asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  if (req.auth.role === 'student' && req.auth.sub !== studentId) {
    return res.status(403).json({ error: "You can only view your own trend" });
  }
  const onlyPublished = req.auth.role === 'student';
  const exams = await query(
    `SELECT * FROM exams WHERE center_id = $1 ${onlyPublished ? 'AND is_published = true' : ''} ORDER BY created_at`,
    [req.auth.centerId]
  );

  const trend = [];
  for (const exam of exams.rows) {
    const data = await computeStudentExam(req.auth.centerId, studentId, exam.id);
    if (data && data.subjectsGraded > 0) {
      trend.push({ exam: { id: exam.id, name: exam.name }, meanPoints: data.meanPoints, meanLevel: data.meanLevel, position: data.position, outOf: data.outOf });
    }
  }
  res.json(trend);
}));
