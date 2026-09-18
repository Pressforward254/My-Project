import { pool } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { SUBLEVEL_POINTS } from '../lib/grading.js';

// Seeds all centers named so far as bare records (so IT already has a real
// list to pick from, with no chance of code collisions as more are added),
// with Ndovoini fleshed out with full demo data — the same shape as the HTML
// prototype, so behavior can be compared side by side.
async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Clearing existing data...');
    await client.query(`
      TRUNCATE edit_requests, remarks, marks, exams, grading_bands,
               teacher_subjects, class_teachers, teacher_logins,
               students, teachers, subjects, classes, admins, centers
      RESTART IDENTITY CASCADE
    `);

    console.log('Creating centers + their admin/teacher logins...');
    const centerDefs = [
      { name: 'Ndovoini Center', code: 'MOHI-NDV', location: 'Nairobi, Kenya', slug: 'ndovoini' },
      { name: 'Joska Center', code: 'MOHI-JOS', location: 'Joska, Kenya', slug: 'joska' },
      { name: 'Turi Center', code: 'MOHI-TUR', location: 'Turi, Kenya', slug: 'turi' },
      { name: 'Coramdeo Center', code: 'MOHI-COR', location: 'Kenya', slug: 'coramdeo' },
      { name: 'Milimani Center', code: 'MOHI-MIL', location: 'Kenya', slug: 'milimani' },
      { name: 'Babadogo Center', code: 'MOHI-BBD', location: 'Nairobi, Kenya', slug: 'babadogo' },
    ];
    const centerIds = {};
    for (const c of centerDefs) {
      const { rows } = await client.query(
        `INSERT INTO centers (name, center_code, location) VALUES ($1, $2, $3) RETURNING id`,
        [c.name, c.code, c.location]
      );
      centerIds[c.name] = rows[0].id;
      await client.query(
        `INSERT INTO admins (center_id, role, full_name, email, password_hash) VALUES ($1, 'school_admin', $2, $3, $4)`,
        [rows[0].id, `${c.name} Admin`, `admin@${c.slug}.mohiafrica.org`, await hashPassword('Admin@2026')]
      );
      await client.query(
        `INSERT INTO teacher_logins (center_id, email, password_hash) VALUES ($1, $2, $3)`,
        [rows[0].id, `${c.slug}@mohiafrica.org`, await hashPassword('Teacher@2026')]
      );
    }
    const centerId = centerIds['Ndovoini Center']; // full demo data below lives on this one

    console.log('Creating IT support account (org-wide, not tied to a center)...');
    await client.query(
      `INSERT INTO admins (center_id, role, full_name, email, password_hash) VALUES (NULL, 'it_support', $1, $2, $3)`,
      ['MOHI IT Support', 'it@mohi.org', await hashPassword('IT@2026')]
    );

    console.log('Creating classes...');
    const classRows = [
      { name: 'Grade 4 Gold', grade: 'Grade 4', stream: 'Gold', section: 'PRIMARY' },
      { name: 'Grade 7 Blue', grade: 'Grade 7', stream: 'Blue', section: 'JUNIOR' },
      { name: 'Grade 8 Green', grade: 'Grade 8', stream: 'Green', section: 'JUNIOR' },
      { name: 'Grade 10 Silver', grade: 'Grade 10', stream: 'Silver', section: 'SENIOR' },
    ];
    const classIds = {};
    for (const c of classRows) {
      const { rows } = await client.query(
        `INSERT INTO classes (center_id, name, grade, stream, section) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [centerId, c.name, c.grade, c.stream, c.section]
      );
      classIds[c.name] = rows[0].id;
    }

    console.log('Creating subjects...');
    const subjectRows = [
      { name: 'Mathematics', section: null },
      { name: 'English', section: null },
      { name: 'Kiswahili', section: null },
      { name: 'Home Science', section: 'JUNIOR' },
      { name: 'Business Studies', section: 'SENIOR' },
      { name: 'Movement Activities', section: 'PRIMARY' },
    ];
    const subjectIds = {};
    for (const s of subjectRows) {
      const { rows } = await client.query(
        `INSERT INTO subjects (center_id, name, section) VALUES ($1,$2,$3) RETURNING id`,
        [centerId, s.name, s.section]
      );
      subjectIds[s.name] = rows[0].id;
    }

    console.log('Creating teachers...');
    const t1 = await client.query(
      `INSERT INTO teachers (center_id, full_name, phone, section) VALUES ($1,$2,$3,'JUNIOR') RETURNING id`,
      [centerId, 'Mrs. Grace Wambui', '0712 345 678']
    );
    const t2 = await client.query(
      `INSERT INTO teachers (center_id, full_name, phone, section) VALUES ($1,$2,$3,'JUNIOR') RETURNING id`,
      [centerId, 'Mr. Peter Otieno', '0723 456 789']
    );
    await client.query(`INSERT INTO class_teachers (class_id, teacher_id) VALUES ($1,$2)`, [classIds['Grade 7 Blue'], t1.rows[0].id]);
    await client.query(`INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1,$2)`, [t1.rows[0].id, subjectIds['Mathematics']]);
    await client.query(`INSERT INTO class_teachers (class_id, teacher_id) VALUES ($1,$2)`, [classIds['Grade 8 Green'], t2.rows[0].id]);
    await client.query(`INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1,$2)`, [t2.rows[0].id, subjectIds['English']]);
    await client.query(`UPDATE classes SET class_teacher_id = $1 WHERE id = $2`, [t1.rows[0].id, classIds['Grade 7 Blue']]);
    await client.query(`UPDATE classes SET class_teacher_id = $1 WHERE id = $2`, [t2.rows[0].id, classIds['Grade 8 Green']]);

    console.log('Creating students...');
    const defaultPw = await hashPassword('Student@2026');
    const students = [
      { id: 'MOHI-0101', name: 'Faith Wanjiru', classId: classIds['Grade 7 Blue'] },
      { id: 'MOHI-0142', name: 'Brian Otieno', classId: classIds['Grade 8 Green'] },
    ];
    for (const s of students) {
      await client.query(
        `INSERT INTO students (school_id_number, center_id, full_name, class_id, password_hash) VALUES ($1,$2,$3,$4,$5)`,
        [s.id, centerId, s.name, s.classId, defaultPw]
      );
    }

    console.log('Creating grading bands (org-wide default CBC scale)...');
    const bands = [
      ['EE1', 'EE', 8, 80, 100], ['EE2', 'EE', 7, 70, 79],
      ['ME1', 'ME', 6, 60, 69], ['ME2', 'ME', 5, 50, 59],
      ['AE1', 'AE', 4, 40, 49], ['AE2', 'AE', 3, 30, 39],
      ['BE1', 'BE', 2, 20, 29], ['BE2', 'BE', 1, 0, 19],
    ];
    for (const [sublevel, level, points, min, max] of bands) {
      await client.query(
        `INSERT INTO grading_bands (center_id, sublevel, level, points, pct_min, pct_max) VALUES (NULL,$1,$2,$3,$4,$5)`,
        [sublevel, level, points, min, max]
      );
    }

    console.log('Creating an exam...');
    await client.query(
      `INSERT INTO exams (center_id, name, term, academic_year, opens_on, closes_on)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [centerId, 'Term 2 Mid-Term 2026', 'Term 2', '2026', 'Mon 4 May 2026', 'Fri 24 Apr 2026']
    );

    await client.query('COMMIT');
    console.log('\nSeed complete.');
    console.log('Centers created:', Object.keys(centerIds).join(', '));
    console.log('Ndovoini Center ID:', centerId);
    console.log('IT support login: it@mohi.org / IT@2026 (lands on dashboard directly, switch centers there)');
    console.log('School admin logins: admin@<slug>.mohiafrica.org / Admin@2026 — e.g. admin@ndovoini.mohiafrica.org');
    console.log('Teacher logins: <slug>@mohiafrica.org / Teacher@2026 — e.g. ndovoini@mohiafrica.org (all sections, one login)');
    console.log('Student login: MOHI-0101 / Student@2026 (forces password reset)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => { console.error(err); process.exit(1); });
