import { Router } from 'express';
import { query } from '../lib/db.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../lib/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const authRouter = Router();

// ---------- ADMIN ----------
// Two kinds of admin share this one login form (per the design's "login stays
// as admin/teacher/parent" — IT is not a fourth tab):
//   - school_admin: individual login, tied to one center, works exactly as before.
//   - it_support:   one org-wide account (it@mohi.org). Logs straight into the
//                    dashboard like anyone else — no center-picker gate before
//                    that. It lands on its most-recently-added center by
//                    default, and switches centers from inside the dashboard
//                    via /admin/switch-center (see the center switcher there).
authRouter.post('/admin/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const { rows } = await query(
    `SELECT id, center_id, role, full_name, password_hash FROM admins WHERE email = $1`,
    [email.trim().toLowerCase()]
  );
  const admin = rows[0];
  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }

  if (admin.role === 'it_support') {
    const centers = await query(`SELECT id, name FROM centers WHERE is_active = true ORDER BY created_at DESC LIMIT 1`);
    if (!centers.rows[0]) return res.status(500).json({ error: 'No centers exist yet — add one first.' });
    const defaultCenter = centers.rows[0];
    const token = signToken({ sub: admin.id, role: 'it_support', centerId: defaultCenter.id });
    return res.json({ token, admin: { id: admin.id, name: admin.full_name, centerId: defaultCenter.id }, isItSupport: true });
  }

  const token = signToken({ sub: admin.id, role: 'admin', centerId: admin.center_id });
  res.json({ token, admin: { id: admin.id, name: admin.full_name, centerId: admin.center_id } });
}));

// IT support: switch to a different center mid-session without logging out again.
// Requires an already-valid it_support token (so this can't be used to escalate
// a school_admin token into cross-center access).
authRouter.post('/admin/switch-center', asyncHandler(async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const { centerId } = req.body;
  if (!token || !centerId) return res.status(400).json({ error: 'Bearer token and centerId are required' });

  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }
  if (claims.role !== 'it_support') return res.status(403).json({ error: 'Only IT support can switch centers' });

  const center = await query(`SELECT id, name FROM centers WHERE id = $1 AND is_active = true`, [centerId]);
  if (!center.rows[0]) return res.status(404).json({ error: 'Center not found' });

  const newToken = signToken({ sub: claims.sub, role: 'it_support', centerId });
  res.json({ token: newToken, center: center.rows[0] });
}));

// ---------- TEACHER (one shared login per center, all sections) ----------
// Step 1: verify the center's one shared credential (e.g. babadogo@mohiafrica.org),
// return every teacher at that center so the client can render "which teacher
// are you?" — the section itself comes from the teacher record they pick next,
// not from the login.
authRouter.post('/teacher/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const { rows } = await query(
    `SELECT id, center_id, password_hash FROM teacher_logins WHERE email = $1`,
    [email.trim().toLowerCase()]
  );
  const login = rows[0];
  if (!login || !(await verifyPassword(password, login.password_hash))) {
    return res.status(401).json({ error: "Those staff credentials don't match our records" });
  }

  const teachers = await query(
    `SELECT id, full_name FROM teachers WHERE center_id = $1 ORDER BY full_name`,
    [login.center_id]
  );

  // Short-lived "pending" token — proves the shared credential was verified,
  // but is not yet a usable API token (no teacherId, so no data access) until
  // step 2 picks a specific person.
  const pendingToken = signToken({ role: 'teacher_pending', centerId: login.center_id });
  res.json({ pendingToken, teachers: teachers.rows });
}));

// Step 2: pick a specific teacher, get a real, usable token.
authRouter.post('/teacher/select', asyncHandler(async (req, res) => {
  const { pendingToken, teacherId } = req.body;
  if (!pendingToken || !teacherId) return res.status(400).json({ error: 'pendingToken and teacherId are required' });

  let claims;
  try {
    claims = verifyToken(pendingToken);
  } catch {
    return res.status(401).json({ error: 'Sign-in expired, please sign in again' });
  }
  if (claims.role !== 'teacher_pending') return res.status(401).json({ error: 'Invalid token for this step' });

  const { rows } = await query(
    `SELECT id, full_name, section FROM teachers WHERE id = $1 AND center_id = $2`,
    [teacherId, claims.centerId]
  );
  if (!rows[0]) return res.status(403).json({ error: 'That teacher is not at this center' });

  const token = signToken({
    sub: teacherId, role: 'teacher', centerId: claims.centerId, section: rows[0].section,
  });
  res.json({ token, teacher: rows[0] });
}));

// ---------- STUDENT / PARENT ----------
// School ID Number is unique ORG-WIDE (see design doc Section 3), so this
// intentionally does not filter by center — the lookup itself tells us the center.
authRouter.post('/student/login', asyncHandler(async (req, res) => {
  const { schoolIdNumber, password } = req.body;
  if (!schoolIdNumber || !password) return res.status(400).json({ error: 'schoolIdNumber and password are required' });

  const { rows } = await query(
    `SELECT id, center_id, full_name, password_hash, password_changed FROM students WHERE school_id_number = $1`,
    [schoolIdNumber.trim()]
  );
  const student = rows[0];
  if (!student || !(await verifyPassword(password, student.password_hash))) {
    return res.status(401).json({ error: 'Incorrect School ID Number or password' });
  }

  if (!student.password_changed) {
    // Forced reset: issue a limited token that can only call /auth/student/set-password.
    const resetToken = signToken({ sub: student.id, role: 'student_reset', centerId: student.center_id });
    return res.json({ needsPasswordChange: true, resetToken });
  }

  const token = signToken({ sub: student.id, role: 'student', centerId: student.center_id });
  res.json({ token, student: { id: student.id, name: student.full_name } });
}));

authRouter.post('/student/set-password', asyncHandler(async (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !newPassword) return res.status(400).json({ error: 'resetToken and newPassword are required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  let claims;
  try {
    claims = verifyToken(resetToken);
  } catch {
    return res.status(401).json({ error: 'Reset session expired, please sign in again' });
  }
  if (claims.role !== 'student_reset') return res.status(401).json({ error: 'Invalid reset token' });

  const passwordHash = await hashPassword(newPassword);
  await query(
    `UPDATE students SET password_hash = $1, password_changed = true WHERE id = $2`,
    [passwordHash, claims.sub]
  );
  const token = signToken({ sub: claims.sub, role: 'student', centerId: claims.centerId });
  res.json({ token });
}));
