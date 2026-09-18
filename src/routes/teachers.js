import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const teachersRouter = Router();
teachersRouter.use(requireAuth);

teachersRouter.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT t.*,
       COALESCE(json_agg(DISTINCT c.id) FILTER (WHERE c.id IS NOT NULL), '[]') AS class_ids,
       COALESCE(json_agg(DISTINCT s.id) FILTER (WHERE s.id IS NOT NULL), '[]') AS subject_ids
     FROM teachers t
     LEFT JOIN class_teachers ct ON ct.teacher_id = t.id
     LEFT JOIN classes c ON c.id = ct.class_id
     LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
     LEFT JOIN subjects s ON s.id = ts.subject_id
     WHERE t.center_id = $1
     GROUP BY t.id
     ORDER BY t.full_name`,
    [req.auth.centerId]
  );
  res.json(rows);
}));

teachersRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { fullName, phone, bio, section, classId, subjectId } = req.body;
  if (!fullName || !section) return res.status(400).json({ error: 'fullName and section are required' });

  const { rows } = await query(
    `INSERT INTO teachers (center_id, full_name, phone, bio, section) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.auth.centerId, fullName, phone || null, bio || null, section]
  );
  const teacher = rows[0];

  if (classId) {
    await query(`INSERT INTO class_teachers (class_id, teacher_id)
                 SELECT id, $2 FROM classes WHERE id = $1 AND center_id = $3
                 ON CONFLICT DO NOTHING`, [classId, teacher.id, req.auth.centerId]);
  }
  if (subjectId) {
    await query(`INSERT INTO teacher_subjects (teacher_id, subject_id)
                 SELECT $1, id FROM subjects WHERE id = $2 AND center_id = $3
                 ON CONFLICT DO NOTHING`, [teacher.id, subjectId, req.auth.centerId]);
  }
  res.status(201).json(teacher);
}));

// Bulk add via CSV — columns: Full Name, Section, Class, Subject, Phone.
// Same name on multiple rows merges into one teacher with all those
// class/subject assignments, so one teacher who teaches several
// class-subject combos only needs one row per combo, not one row total.
teachersRouter.post('/bulk', requireRole('admin'), asyncHandler(async (req, res) => {
  const { csv } = req.body;
  if (!csv || !csv.trim()) return res.status(400).json({ error: 'csv text is required' });

  const [classes, subjects] = await Promise.all([
    query(`SELECT id, name FROM classes WHERE center_id = $1`, [req.auth.centerId]),
    query(`SELECT id, name FROM subjects WHERE center_id = $1`, [req.auth.centerId]),
  ]);
  const classByName = new Map(classes.rows.map(c => [c.name.toLowerCase(), c.id]));
  const subjectByName = new Map(subjects.rows.map(s => [s.name.toLowerCase(), s.id]));

  const lines = csv.trim().split(/\r?\n/).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
  const start = /name/i.test(lines[0]?.[0] || '') ? 1 : 0;
  let added = 0;
  const skipped = [];
  const teacherIdByName = new Map(); // within this upload, so repeated names merge

  for (let i = start; i < lines.length; i++) {
    const [name, sectionRaw, className, subjectName, phone] = lines[i];
    if (!name) { skipped.push(`Row ${i + 1}: missing teacher name`); continue; }
    const section = (sectionRaw || '').trim().toUpperCase();
    if (!['PRIMARY', 'JUNIOR', 'SENIOR'].includes(section)) {
      skipped.push(`Row ${i + 1}: section must be PRIMARY, JUNIOR or SENIOR (got "${sectionRaw}")`); continue;
    }
    let teacherId = teacherIdByName.get(name.toLowerCase());
    if (!teacherId) {
      const existing = await query(`SELECT id FROM teachers WHERE center_id = $1 AND lower(full_name) = lower($2)`, [req.auth.centerId, name.trim()]);
      if (existing.rows[0]) {
        teacherId = existing.rows[0].id;
      } else {
        const { rows } = await query(
          `INSERT INTO teachers (center_id, full_name, phone, section) VALUES ($1,$2,$3,$4) RETURNING id`,
          [req.auth.centerId, name.trim(), (phone || '').trim() || null, section]
        );
        teacherId = rows[0].id;
        added++;
      }
      teacherIdByName.set(name.toLowerCase(), teacherId);
    }
    const classId = className ? classByName.get(className.trim().toLowerCase()) : null;
    if (className && !classId) skipped.push(`Row ${i + 1}: class "${className}" not found`);
    if (classId) await query(`INSERT INTO class_teachers (class_id, teacher_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [classId, teacherId]);
    const subjectId = subjectName ? subjectByName.get(subjectName.trim().toLowerCase()) : null;
    if (subjectName && !subjectId) skipped.push(`Row ${i + 1}: subject "${subjectName}" not found`);
    if (subjectId) await query(`INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [teacherId, subjectId]);
  }
  res.json({ added, skipped });
}));

teachersRouter.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { fullName, phone, bio } = req.body;
  const { rows } = await query(
    `UPDATE teachers SET full_name = COALESCE($1, full_name), phone = $2, bio = $3
     WHERE id = $4 AND center_id = $5 RETURNING *`,
    [fullName || null, phone || null, bio || null, req.params.id, req.auth.centerId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Teacher not found' });
  res.json(rows[0]);
}));

teachersRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM teachers WHERE id = $1 AND center_id = $2`, [req.params.id, req.auth.centerId]);
  if (!rowCount) return res.status(404).json({ error: 'Teacher not found' });
  res.status(204).end();
}));
