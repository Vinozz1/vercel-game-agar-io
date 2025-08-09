import { sql } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }
  const { code } = req.body || {};
  if (!code) { res.status(400).json({ error: 'Missing code' }); return; }
  await sql`DELETE FROM rooms WHERE code=${code}`;
  res.status(200).json({ ok: true });
}


