import { GameError, newPlayer, createRoom, joinRoom, act, tick, view } from './game.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const roomCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
export async function api(request, store) {
  try {
    const url = new URL(request.url);
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
    let data = {};
    if (request.method === 'POST') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) throw new GameError('Запрос с другого сайта запрещён.', 403);
      const body = await request.text();
      if (body.length > 100000) throw new GameError('Запрос слишком большой.', 413);
      try { data = JSON.parse(body); } catch { throw new GameError('Неверный формат запроса.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new GameError('Неверный формат запроса.');
    }
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const auth = crypto.randomUUID() + crypto.randomUUID();
      const p = newPlayer(data.name, auth);
      for (let i = 0; i < 100; i++) {
        const room = createRoom(roomCode(), p, data.settings, Date.now());
        if (await store.create(room)) return json({ token: auth, room: view(room, auth) }, 201);
      }
      throw new GameError('Не удалось создать комнату. Попробуйте ещё раз.', 503);
    }
    // Keep existing six-character invitations valid; new rooms use four digits.
    const match = url.pathname.match(/^\/api\/rooms\/([0-9]{4}|[A-Z2-9]{6})(?:\/(join|action))?$/);
    if (!match) throw new GameError('Комната не найдена.', 404);
    const [, code, route] = match;
    if (request.method !== (route ? 'POST' : 'GET')) throw new GameError('Метод не поддерживается.', 405);
    let joinedPlayer;
    if (route === 'join') {
      joinedPlayer = newPlayer(data.name, crypto.randomUUID() + crypto.randomUUID());
    }
    // Compare-and-swap retries preserve simultaneous joins, mines and score updates.
    for (let attempt = 0; attempt < 15; attempt++) {
      const record = await store.get(code);
      if (!record || Date.now() - record.updated > 7 * 86400000 ||
        (!record.room.players.length && !(route === 'join' && record.room.departed?.length))) throw new GameError('Комната не найдена или срок её хранения истёк.', 404);
      const room = record.room;
      const now = Date.now();
      let changed = false;
      let rejoined = false;
      if (route === 'join') { rejoined = joinRoom(room, joinedPlayer, now).id !== joinedPlayer.id; changed = true; }
      else if (route === 'action') { act(room, token, data.action, data.data, now); changed = true; }
      else {
        view(room, token, now); // Authenticate before advancing time.
        changed = tick(room, now);
      }
      const auth = joinedPlayer?.token || token;
      const response = route === 'action' && data.action === 'leave' ? { left: true } : { room: view(room, auth, now), ...(joinedPlayer && { token: auth, rejoined }) };
      if (!changed || await store.save(room, record.version, now)) return json(response);
    }
    throw new GameError('Комната занята. Повторите действие через секунду.', 409);
  } catch (error) {
    if (error instanceof GameError) return json({ error: error.message }, error.status);
    console.error('API error:', error);
    return json({ error: 'Не удалось выполнить запрос. Попробуйте ещё раз.' }, 500);
  }
}
