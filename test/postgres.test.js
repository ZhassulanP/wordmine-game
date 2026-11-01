import test from 'node:test';
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';
import { createPostgresStore } from '../src/postgres-store.js';
import { api } from '../src/api.js';
import { createRoom, newPlayer } from '../src/game.js';

test('Postgres persists across handlers and preserves concurrent multiplayer updates', { skip: !process.env.DATABASE_URL, timeout: 120000 }, async () => {
  const connection = process.env.DATABASE_URL;
  const sql = neon(connection);
  let code;
  const call = async (path, data, token) => {
    // A fresh adapter on every request models independent function instances.
    const response = await api(new Request('https://game.test' + path, {
      method: data ? 'POST' : 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      ...(data && { body: JSON.stringify(data) })
    }), createPostgresStore(connection));
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  };
  try {
    const host = await call('/api/rooms', { name: 'Postgres smoke host', password: 'ACM', settings: { capacity: 20 } });
    code = host.room.code;
    assert.match(code, /^[0-9]{4}$/);
    const base = '/api/rooms/' + code;
    const guests = await Promise.all(Array.from({ length: 12 }, (_, i) => call(base + '/join', { name: 'Postgres guest ' + i, password: 'acm' })));
    const clients = [host, ...guests];
    const state = await call(base, null, host.token);
    assert.equal(state.room.players.length, 13);
    assert.equal(state.room.settings.capacity, 20);
    assert.ok(state.room.players.every(p => !p.ready));
    const started = await call(base + '/action', { action: 'start' }, host.token);
    assert.equal(started.room.settings.miningDuration, 60);
    assert.equal(started.room.round.deadline - started.room.serverNow, 60000);
    const miners = clients.filter(client => ![started.room.round.explainerId, started.room.round.guesserId].includes(client.room.me));
    const [late] = await Promise.all([
      call(base + '/join', { name: 'Live joiner', password: 'acm' }),
      call(base + '/action', { action: 'kick', data: { playerId: miners[1].room.me } }, host.token),
      call(base + '/action', { action: 'mine', data: { word: 'ловушка', roundId: started.room.round.id } }, miners[0].token)
    ]);
    clients.push(late);
    const dynamic = await call(base, null, host.token);
    assert.equal(dynamic.room.players.length, 13);
    assert.equal(dynamic.room.round.id, started.room.round.id);
    assert.ok(!dynamic.room.players.some(p => p.id === miners[1].room.me));
    const pending = clients.filter(c => dynamic.room.players.some(p => p.id === c.room.me) &&
      ![started.room.round.explainerId, started.room.round.guesserId, miners[0].room.me].includes(c.room.me));
    await Promise.all(pending.map(c => call(base + '/action', { action: 'mine', data: { word: 'ловушка', roundId: started.room.round.id } }, c.token)));
    const guesserToken = clients.find(client => client.room.me === started.room.round.guesserId).token;
    const guesser = await call(base, null, guesserToken);
    assert.equal(guesser.room.round.word, null);
    assert.equal(guesser.room.round.mines, null);
    assert.equal(guesser.room.round.mineCount, 11);
    assert.equal(guesser.room.phase, 'explaining');
    assert.equal(guesser.room.round.deadline, null);
    await call(base + '/action', { action: 'guess', data: { word: started.room.round.word.toUpperCase() } }, guesserToken);
    const result = await call(base, null, host.token);
    assert.equal(result.room.phase, 'result');
    assert.equal(result.room.players[0].score, 1);
    assert.equal(result.room.players[1].score, 1);
    assert.equal(result.room.players[0].turnsExplained, 1);
    assert.equal(result.room.players[1].turnsGuessed, 1);
    const recovered = await call(base + '/join', { name: 'POSTGRES SMOKE HOST', password: 'acm' });
    assert.equal(recovered.rejoined, true); assert.equal(recovered.room.me, host.room.me);
    assert.equal(recovered.room.players.length, 13); assert.equal(recovered.room.players[0].score, 1);
    assert.equal(recovered.room.players[0].turnsExplained, 1);
    const oldSession = await api(new Request('https://game.test' + base, { headers: { Authorization: `Bearer ${host.token}` } }), createPostgresStore(connection));
    assert.equal(oldSession.status, 401); host.token = recovered.token;
    const storeA = createPostgresStore(connection), storeB = createPostgresStore(connection);
    const a = await storeA.get(code), b = await storeB.get(code);
    assert.equal(await storeA.save(a.room, a.version, Date.now()), true);
    assert.equal(await storeB.save(b.room, b.version, Date.now()), false);
    const handler = (await import('../api/index.js')).default;
    const rewritten = await handler.fetch(new Request(`https://game.test/api?route=rooms/${code}`, {
      headers: { Authorization: `Bearer ${host.token}` }
    }));
    assert.equal(rewritten.status, 200);
    assert.equal((await rewritten.json()).room.code, code);
    const rewrittenPost = await handler.fetch(new Request(`https://game.test/api?route=rooms/${code}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.token}`, Origin: 'https://game.test' },
      body: JSON.stringify({ action: 'next' })
    }));
    assert.equal(rewrittenPost.status, 200);
    assert.equal((await rewrittenPost.json()).room.phase, 'mining');
    await call(base + '/action', { action: 'leave' }, guesserToken);
    const occupied = await storeA.get(code);
    assert.equal(await storeB.create({ ...occupied.room, players: [] }), false);
    occupied.room.players = [];
    assert.equal(await storeA.save(occupied.room, occupied.version, Date.now()), true);
    const replacement = createRoom(code, newPlayer('New host', 'replacement-token'), {}, Date.now());
    assert.equal(await storeB.create(replacement), false, 'saved players keep their room code for recovery');
    const unreserved = await storeA.get(code); unreserved.room.departed = [];
    assert.equal(await storeA.save(unreserved.room, unreserved.version, Date.now()), true);
    assert.equal(await storeB.create(replacement), true);
    const reused = await storeA.get(code);
    assert.equal(reused.room.players[0].id, replacement.hostId);
    assert.equal(await storeA.save(occupied.room, occupied.version, Date.now()), false);
  } finally {
    if (code) await sql`DELETE FROM rooms WHERE code = ${code}`;
  }
});
