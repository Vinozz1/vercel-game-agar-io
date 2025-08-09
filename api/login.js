import { sql } from './_db.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }
  const { username, password } = req.body || {};
  if (!username || !password) { res.status(400).json({ error: 'Missing fields' }); return; }
  const rows = await sql`SELECT username, password_hash, role FROM users WHERE username=${username}`;
  if (rows.length === 0) { res.status(401).json({ error: 'Invalid' }); return; }
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) { res.status(401).json({ error: 'Invalid' }); return; }
  res.status(200).json({ ok: true });
}


