import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { api } from './api.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = process.env.DATA_DIR || resolve(root, 'data');
await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, 'rooms.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
db.exec((await readFile(resolve(root, 'drizzle/0000_rooms.sql'), 'utf8')).replaceAll('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ').replaceAll('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '));
const store = {
  async create(room) { return db.prepare('INSERT OR IGNORE INTO rooms(code,version,updated,data) VALUES(?,0,?,?)').run(room.code, Date.now(), JSON.stringify(room)).changes === 1; },
  async get(code) { const row = db.prepare('SELECT * FROM rooms WHERE code=?').get(code); return row && { room: JSON.parse(row.data), version: row.version, updated: row.updated }; },
  async save(room, version, now) { return db.prepare('UPDATE rooms SET data=?,version=version+1,updated=? WHERE code=? AND version=?').run(JSON.stringify(room), now, room.code, version).changes === 1; }
};
const clean = setInterval(() => db.prepare('DELETE FROM rooms WHERE updated < ?').run(Date.now() - 7 * 86400000), 3600000);
clean.unref();
const types = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const port = Number(process.env.PORT || 3000);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (url.pathname.startsWith('/api/')) {
      const parts = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 100000) { res.writeHead(413); res.end(); return; } parts.push(chunk); }
      const response = await api(new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(parts) } : {}) }), store);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } else {
      const entry = types[url.pathname];
      if (!entry) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'" });
      res.end(await readFile(resolve(root, 'public', entry[0])));
    }
  } catch (e) { console.error(e); res.writeHead(500); res.end('Server error'); }
});
server.listen(port, '0.0.0.0', () => console.log(`Слова-мины: http://localhost:${port}\nFor friends on this network, use this computer's LAN IP and port ${port}.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
