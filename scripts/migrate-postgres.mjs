import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Run with vercel env run -- npm run db:migrate.');
const sql = neon(process.env.DATABASE_URL);
const migration = await readFile(new URL('../migrations/postgres/001_rooms.sql', import.meta.url), 'utf8');
for (const statement of migration.split(';').map(s => s.trim()).filter(Boolean)) await sql.query(statement);
console.log('Postgres room schema is ready.');
