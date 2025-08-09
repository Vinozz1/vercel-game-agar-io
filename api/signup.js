import { sql, initSchema } from './_db.js';
import bcrypt from 'bcryptjs';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  await initSchema();
  const body = await req.json().catch(()=>({}));
  const { username, password } = body || {};
  if (!username || !password) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  const rows = await sql`SELECT username FROM users WHERE username=${username}`;
  if (rows.length) return new Response(JSON.stringify({ error: 'Taken' }), { status: 409 });
  const hash = await bcrypt.hash(password, 10);
  await sql`INSERT INTO users(username, password_hash, role) VALUES(${username}, ${hash}, 'player')`;
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}


