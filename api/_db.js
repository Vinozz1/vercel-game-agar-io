import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL || '');

export async function initSchema() {
  await sql`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player'
  );`;
  await sql`CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    vs_bot BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );`;
}



