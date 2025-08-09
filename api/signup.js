import { sql } from './_db.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }
  const { username, password } = req.body || {};
  if (!username || !password) { res.status(400).json({ error: 'Missing fields' }); return; }
  const rows = await sql`SELECT username FROM users WHERE username=${username}`;
  if (rows.length) { res.status(409).json({ error: 'Taken' }); return; }
  const hash = await bcrypt.hash(password, 10);
  await sql`INSERT INTO users(username, password_hash, role) VALUES(${username}, ${hash}, 'player')`;
  res.status(200).json({ ok: true });
}


