import { sql, initSchema } from './_db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  await initSchema();
  const rows = await sql`SELECT code, created_by, vs_bot FROM rooms ORDER BY created_at DESC LIMIT 50`;
  return new Response(JSON.stringify({ rooms: rows }), { status: 200, headers: { 'content-type': 'application/json' } });
}


