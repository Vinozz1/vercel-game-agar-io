import { sql, initSchema } from './_db.js';

export const config = { runtime: 'edge' };

function randomCode(n=6){const a='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';let s='';for(let i=0;i<n;i++)s+=a[Math.floor(Math.random()*a.length)];return s;}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  await initSchema();
  const body = await req.json().catch(()=>({}));
  const { username, vsBot } = body || {};
  if (!username) return new Response(JSON.stringify({ error: 'Missing username' }), { status: 400 });
  const code = randomCode();
  await sql`INSERT INTO rooms(code, created_by, vs_bot) VALUES(${code}, ${username}, ${!!vsBot})`;
  return new Response(JSON.stringify({ ok: true, code }), { status: 200, headers: { 'content-type': 'application/json' } });
}


