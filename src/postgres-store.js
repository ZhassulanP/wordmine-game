import { neon } from '@neondatabase/serverless';

export function createPostgresStore(connectionString) {
  const sql = neon(connectionString);
  return {
    async create(room) {
      const now = Date.now();
      await sql`DELETE FROM rooms WHERE updated < ${now - 7 * 86400000}`;
      const rows = await sql`INSERT INTO rooms(code, version, updated, data)
        VALUES (${room.code}, 0, ${now}, ${JSON.stringify(room)}::jsonb)
        ON CONFLICT (code) DO UPDATE SET version = rooms.version + 1,
          updated = EXCLUDED.updated, data = EXCLUDED.data
        WHERE jsonb_array_length(rooms.data->'players') = 0
          AND COALESCE(jsonb_array_length(rooms.data->'departed'), 0) = 0 RETURNING code`;
      return rows.length === 1;
    },
    async get(code) {
      const [row] = await sql`SELECT version, updated, data FROM rooms WHERE code = ${code}`;
      return row && { room: row.data, version: row.version, updated: Number(row.updated) };
    },
    async save(room, version, now) {
      // The version predicate atomically rejects an update based on stale state.
      const rows = await sql`UPDATE rooms SET data = ${JSON.stringify(room)}::jsonb,
        version = version + 1, updated = ${now}
        WHERE code = ${room.code} AND version = ${version} RETURNING code`;
      return rows.length === 1;
    }
  };
}
