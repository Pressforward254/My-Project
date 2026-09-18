import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { SUBLEVEL_POINTS, isValidSublevel, percentToSublevel } from '../lib/grading.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const marksRouter = Router();
marksRouter.use(requireAuth);

// Grid data for a teacher's mark-entry screen: every student in a class,
// with their existing mark (if any) for one subject/exam.
marksRouter.get('/', requireRole('teacher', 'admin'), asyncHandler(async (req, res) => {
  const { examId, classId, subjectId } = req.query;
  if (!examId || !classId || !subjectId) return res.status(400).json({ error: 'examId, classId and subjectId are required' });

  const { rows } = await query(
    `SELECT s.id AS student_id, s.full_name, m.sublevel, m.points, m.percent
     FROM students s
     LEFT JOIN marks m ON m.student_id = s.id AND m.exam_id = $1 AND m.subject_id = $2
     WHERE s.class_id = $3 AND s.center_id = $4
     ORDER BY s.full_name`,
    [examId, subjectId, classId, req.auth.centerId]
  );
  res.json(rows);
}));

// Enter or edit one student's mark for one subject/exam.
// Mirrors the prototype's setMark()/handleMarkChange() approval gating exactly:
// editing a mark that already exists on a PUBLISHED exam queues an edit_request
// for admin approval instead of applying immediately.
marksRouter.put('/', requireRole('teacher', 'admin'), asyncHandler(async (req, res) => {
  const { examId, studentId, subjectId } = req.body;
  let { sublevel, percent } = req.body;
  if (!examId || !studentId || !subjectId) {
    return res.status(400).json({ error: 'examId, studentId and subjectId are required' });
  }
  if (percent != null && percent !== '') {
    percent = Math.max(0, Math.min(100, Number(percent)));
    if (!sublevel) sublevel = percentToSublevel(percent);
  } else {
    percent = null;
  }
  if (!sublevel || !isValidSublevel(sublevel)) {
    return res.status(400).json({ error: 'A valid sublevel (or percent) is required' });
  }

  // Ownership checks — every id in the request must resolve inside this center.
  const exam = await query(`SELECT id, is_published FROM exams WHERE id = $1 AND center_id = $2`, [examId, req.auth.centerId]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found at this center' });
  const student = await query(`SELECT id, full_name FROM students WHERE id = $1 AND center_id = $2`, [studentId, req.auth.centerId]);
  if (!student.rows[0]) return res.status(404).json({ error: 'Student not found at this center' });
  const subject = await query(`SELECT id, name FROM subjects WHERE id = $1 AND center_id = $2`, [subjectId, req.auth.centerId]);
  if (!subject.rows[0]) return res.status(404).json({ error: 'Subject not found at this center' });

  const points = SUBLEVEL_POINTS[sublevel];
  const existing = await query(
    `SELECT id, sublevel FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3`,
    [examId, studentId, subjectId]
  );

  if (exam.rows[0].is_published && existing.rows[0]) {
    const teacherId = req.auth.role === 'teacher' ? req.auth.sub : null;
    const label = `Mark — ${subject.rows[0].name} · ${student.rows[0].full_name}`;
    const { rows } = await query(
      `INSERT INTO edit_requests (center_id, type, label, old_value, new_value, requested_by_teacher_id, student_id, extra_json)
       VALUES ($1, 'MARK', $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.auth.centerId, label, existing.rows[0].sublevel, sublevel, teacherId, studentId,
        JSON.stringify({ examId, studentId, subjectId, percent })]
    );
    return res.status(202).json({ queued: true, editRequest: rows[0] });
  }

  const teacherId = req.auth.role === 'teacher' ? req.auth.sub : null;
  const { rows } = await query(
    `INSERT INTO marks (exam_id, student_id, subject_id, sublevel, points, percent, entered_by_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (exam_id, student_id, subject_id)
     DO UPDATE SET sublevel = $4, points = $5, percent = $6, entered_by_id = $7, updated_at = now()
     RETURNING *`,
    [examId, studentId, subjectId, sublevel, points, percent, teacherId]
  );
  res.json({ queued: false, mark: rows[0] });
}));

// Clear a mark entirely (teacher picks "— Not graded —"). Same ownership
// checks as PUT, and the same approval gate: clearing a mark on a published
// exam queues a request instead of deleting outright.
marksRouter.delete('/', requireRole('teacher', 'admin'), asyncHandler(async (req, res) => {
  const { examId, studentId, subjectId } = req.query;
  if (!examId || !studentId || !subjectId) {
    return res.status(400).json({ error: 'examId, studentId and subjectId are required' });
  }
  const exam = await query(`SELECT id, is_published FROM exams WHERE id = $1 AND center_id = $2`, [examId, req.auth.centerId]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found at this center' });
  const existing = await query(`SELECT id, sublevel FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3`, [examId, studentId, subjectId]);
  if (!existing.rows[0]) return res.status(204).end(); // nothing to clear

  if (exam.rows[0].is_published) {
    const subject = await query(`SELECT name FROM subjects WHERE id = $1`, [subjectId]);
    const student = await query(`SELECT full_name FROM students WHERE id = $1`, [studentId]);
    const teacherId = req.auth.role === 'teacher' ? req.auth.sub : null;
    const label = `Mark (clear) — ${subject.rows[0]?.name || ''} · ${student.rows[0]?.full_name || ''}`;
    const { rows } = await query(
      `INSERT INTO edit_requests (center_id, type, label, old_value, new_value, requested_by_teacher_id, student_id, extra_json)
       VALUES ($1, 'MARK', $2, $3, '', $4, $5, $6) RETURNING *`,
      [req.auth.centerId, label, existing.rows[0].sublevel, teacherId, studentId, JSON.stringify({ examId, studentId, subjectId, percent: null, clear: true })]
    );
    return res.status(202).json({ queued: true, editRequest: rows[0] });
  }

  await query(`DELETE FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3`, [examId, studentId, subjectId]);
  res.status(204).end();
}));

// Whole-school bulk upload for one exam — admin only. Columns: School ID,
// Subject, Score (a CBC sub-level OR a 0-100 percentage). Every student's
// own class is looked up automatically, so one CSV can cover every class at
// once instead of teachers entering marks one class/subject at a time.
// Applies directly even on a published exam — this is an explicit admin bulk
// action, not a teacher edit, so it doesn't go through the approval queue.
marksRouter.post('/bulk', requireRole('admin'), asyncHandler(async (req, res) => {
  const { examId, csv } = req.body;
  if (!examId || !csv || !csv.trim()) return res.status(400).json({ error: 'examId and csv text are required' });

  const exam = await query(`SELECT id FROM exams WHERE id = $1 AND center_id = $2`, [examId, req.auth.centerId]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found at this center' });

  const [students, subjects] = await Promise.all([
    query(`SELECT id, school_id_number FROM students WHERE center_id = $1`, [req.auth.centerId]),
    query(`SELECT id, name FROM subjects WHERE center_id = $1`, [req.auth.centerId]),
  ]);
  const studentByCode = new Map(students.rows.map(s => [s.school_id_number.toLowerCase(), s.id]));
  const subjectByName = new Map(subjects.rows.map(s => [s.name.toLowerCase(), s.id]));

  const lines = csv.trim().split(/\r?\n/).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
  const start = /school ?id/i.test(lines[0]?.[0] || '') ? 1 : 0;
  let added = 0;
  const skipped = [];

  for (let i = start; i < lines.length; i++) {
    const [schoolId, subjectName, scoreRaw] = lines[i];
    const studentId = schoolId ? studentByCode.get(schoolId.trim().toLowerCase()) : null;
    if (!studentId) { skipped.push(`Row ${i + 1}: School ID "${schoolId}" not found`); continue; }
    const subjectId = subjectName ? subjectByName.get(subjectName.trim().toLowerCase()) : null;
    if (!subjectId) { skipped.push(`Row ${i + 1}: subject "${subjectName}" not found`); continue; }

    const score = (scoreRaw || '').trim();
    let sublevel, percent = null;
    if (isValidSublevel(score.toUpperCase())) {
      sublevel = score.toUpperCase();
    } else {
      const pct = Number(score.replace('%', ''));
      if (!isNaN(pct) && pct >= 0 && pct <= 100) { percent = pct; sublevel = percentToSublevel(pct); }
      else { skipped.push(`Row ${i + 1}: "${scoreRaw}" isn't a valid sub-level or 0-100 percentage`); continue; }
    }
    const points = SUBLEVEL_POINTS[sublevel];
    await query(
      `INSERT INTO marks (exam_id, student_id, subject_id, sublevel, points, percent, entered_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,NULL)
       ON CONFLICT (exam_id, student_id, subject_id)
       DO UPDATE SET sublevel = $4, points = $5, percent = $6, updated_at = now()`,
      [examId, studentId, subjectId, sublevel, points, percent]
    );
    added++;
  }
  res.json({ added, skipped });
}));
