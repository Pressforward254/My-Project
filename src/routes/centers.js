import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { hashPassword } from '../lib/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const centersRouter = Router();
centersRouter.use(requireAuth);

// Derives "babadogo" from "Babadogo Center" / "Babadogo" — used to build
// admin@<slug>.mohiafrica.org and <slug>@mohiafrica.org automatically.
function slugify(name) {
  return name.replace(/\bcenter\b/i, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// IT support sees every center (this is the whole point of the IT dimension —
// one view across all ~42 as they're onboarded). A school_admin only ever
// sees their own single center here, for consistency/display purposes —
// they still can't query another center's classes/students/etc. even if they
// somehow learned its id, since every other route filters by req.auth.centerId,
// which a school_admin's token can't change.
centersRouter.get('/', asyncHandler(async (req, res) => {
  if (req.auth.role === 'it_support') {
    const { rows } = await query(`SELECT * FROM centers ORDER BY name`);
    return res.json(rows);
  }
  const { rows } = await query(`SELECT * FROM centers WHERE id = $1`, [req.auth.centerId]);
  res.json(rows);
}));

// Only IT support onboards new centers — this is deliberately not exposed to
// requireRole('admin'), so a school_admin can never create a center (which
// would otherwise let them mint data outside their own walled-off scope).
//
// Creating a center also creates its two logins automatically, following the
// naming convention: admin@<slug>.mohiafrica.org (school admin, individual)
// and <slug>@mohiafrica.org (one shared teacher login covering every
// section — see auth.js). Both start on a default password that's returned
// once here so IT can hand it to the center; change it after first login.
const DEFAULT_ADMIN_PASSWORD = 'Admin@2026';
const DEFAULT_TEACHER_PASSWORD = 'Teacher@2026';

centersRouter.post('/', (req, res, next) => {
  if (req.auth.role !== 'it_support') return res.status(403).json({ error: 'Only IT support can add centers' });
  next();
}, asyncHandler(async (req, res) => {
  const { name, centerCode, location } = req.body;
  if (!name || !centerCode) return res.status(400).json({ error: 'name and centerCode are required' });

  const dupe = await query(`SELECT id FROM centers WHERE center_code = $1`, [centerCode.trim().toUpperCase()]);
  if (dupe.rows[0]) return res.status(409).json({ error: `Center code "${centerCode}" is already in use` });

  const slug = slugify(name);
  const adminEmail = `admin@${slug}.mohiafrica.org`;
  const teacherEmail = `${slug}@mohiafrica.org`;
  const emailDupe = await query(`SELECT 1 FROM admins WHERE email = $1 UNION SELECT 1 FROM teacher_logins WHERE email = $2`, [adminEmail, teacherEmail]);
  if (emailDupe.rows[0]) return res.status(409).json({ error: `A login for "${slug}" already exists — pick a more distinct center name.` });

  const { rows } = await query(
    `INSERT INTO centers (name, center_code, location) VALUES ($1, $2, $3) RETURNING *`,
    [name, centerCode.trim().toUpperCase(), location || null]
  );
  const center = rows[0];

  await query(
    `INSERT INTO admins (center_id, role, full_name, email, password_hash) VALUES ($1, 'school_admin', $2, $3, $4)`,
    [center.id, `${name} Admin`, adminEmail, await hashPassword(DEFAULT_ADMIN_PASSWORD)]
  );
  await query(
    `INSERT INTO teacher_logins (center_id, email, password_hash) VALUES ($1, $2, $3)`,
    [center.id, teacherEmail, await hashPassword(DEFAULT_TEACHER_PASSWORD)]
  );

  res.status(201).json({
    ...center,
    logins: {
      admin: { email: adminEmail, password: DEFAULT_ADMIN_PASSWORD },
      teacher: { email: teacherEmail, password: DEFAULT_TEACHER_PASSWORD },
    },
  });
}));

centersRouter.patch('/:id/active', (req, res, next) => {
  if (req.auth.role !== 'it_support') return res.status(403).json({ error: 'Only IT support can do this' });
  next();
}, asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  const { rows } = await query(`UPDATE centers SET is_active = $1 WHERE id = $2 RETURNING *`, [!!isActive, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Center not found' });
  res.json(rows[0]);
}));
