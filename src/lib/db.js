import pg from 'pg';
import 'dotenv/config';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Thin query helper. Deliberately NOT an ORM: for a system whose central
// promise is "one center can never see another's data," every query that
// touches a center-scoped table should have its WHERE center_id = $1 clause
// visible in the code, not hidden behind an abstraction. See lib/scoped.js
// for the helper that makes this hard to forget.
export async function query(text, params) {
  return pool.query(text, params);
}
