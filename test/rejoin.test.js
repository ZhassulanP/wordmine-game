import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createRoom, joinRoom, newPlayer, tick, view } from '../src/game.js';
import { api } from '../src/api.js';

function setup(count = 4, capacity = count) {
  const room = createRoom('1234', newPlayer('Host', 'host'), { capacity, cycles: 2 }, 1000);
  for (let i = 1; i < count; i++) joinRoom(room, newPlayer('Player ' + i, 'token-' + i), 1000);
  act(room, 'host', 'start', {}, 1000);
  return room;
}
function finishTurn(room) {
  for (const p of room.players) if (![room.round.explainerId, room.round.guesserId].includes(p.id)) act(room, p.token, 'mine', { word: 'ловушка' }, 1001);
  tick(room, room.round.deadline);
  act(room, 'host', 'guessed', {}, 1002);
}
test('same nickname reconnects in a full room without changing identity, role or schedule', () => {
  const room = setup(); finishTurn(room); act(room, 'host', 'next', {}, 1003);
  const oldId = room.hostId, progress = structuredClone(room.progress), schedule = structuredClone(room.schedule), round = structuredClone(room.round);
  const restored = joinRoom(room, newPlayer('  HOST  ', 'new-host-token'), 1004);
  assert.equal(restored.id, oldId); assert.equal(restored.score, 1); assert.equal(restored.name, 'Host');
  assert.equal(room.players.length, 4); assert.equal(room.hostId, oldId);
  assert.deepEqual(room.progress, progress); assert.deepEqual(room.schedule, schedule); assert.deepEqual(room.round, round);
  assert.equal(view(room, 'new-host-token').me, oldId); assert.throws(() => view(room, 'host'));
  act(room, 'new-host-token', 'skip', {}, 1005);
});
test('an active guesser reconnects without seeing the word or mines', () => {
  const room = setup(), original = room.players.find(p => p.id === room.round.guesserId);
  const oldToken = original.token, roundId = room.round.id;
  joinRoom(room, newPlayer(original.name.toUpperCase(), 'reconnected'), 1001);
  const state = view(room, 'reconnected');
  assert.equal(state.round.id, roundId); assert.equal(state.me, original.id); assert.equal(state.round.role, 'guesser');
  assert.equal(state.round.word, null); assert.equal(state.round.mines, null); assert.throws(() => view(room, oldToken));
});
test('a miner reconnects with the same submitted mine', () => {
  const room = setup(), miner = room.players[2], oldToken = miner.token;
  act(room, oldToken, 'mine', { word: 'два слова' }, 1001);
  joinRoom(room, newPlayer(miner.name, 'reconnected'), 1002);
  const state = view(room, 'reconnected');
  assert.equal(state.me, miner.id); assert.equal(state.round.myMine, 'два слова'); assert.equal(state.round.mineCount, 1);
  assert.equal(room.players.length, 4); assert.throws(() => view(room, oldToken));
});
test('leaving and returning restores score and completed roles without reclaiming admin', () => {
  const room = setup(); finishTurn(room); act(room, 'host', 'next', {}, 1003);
  const id = room.hostId, progress = structuredClone(room.progress[id]);
  act(room, 'host', 'leave', {}, 1004); const newHost = room.hostId;
  assert.notEqual(newHost, id); assert.equal(room.departed.length, 1);
  assert.ok(!JSON.stringify(room.departed).includes('"token"'));
  assert.ok(!JSON.stringify(view(room, room.players[0].token)).includes('departed'));
  const returned = joinRoom(room, newPlayer('host', 'return-token'), 1005);
  assert.equal(returned.id, id); assert.equal(returned.score, 1); assert.deepEqual(room.progress[id], progress);
  assert.equal(room.hostId, newHost); assert.equal(room.departed.length, 0);
});
test('a kicked player can rejoin by nickname without resetting their game progress', () => {
  const room = setup(); finishTurn(room);
  const departing = room.players[1], id = departing.id, progress = structuredClone(room.progress[id]);
  act(room, 'host', 'kick', { playerId: id }, 1003); assert.throws(() => view(room, departing.token));
  const restored = joinRoom(room, newPlayer(departing.name, 'return-token'), 1004);
  assert.equal(restored.id, id); assert.equal(restored.score, 1); assert.deepEqual(room.progress[id], progress);
  assert.equal(room.players.filter(p => p.id === id).length, 1);
});
test('departed players are reset when the admin starts a new match', () => {
  const room = setup(); finishTurn(room);
  const oldHost = room.hostId;
  act(room, 'host', 'leave', {}, 1003);
  const admin = room.players.find(p => p.id === room.hostId);
  act(room, admin.token, 'lobby', {}, 1004); act(room, admin.token, 'start', {}, 1005);
  const restored = joinRoom(room, newPlayer('Host', 'return-token'), 1006);
  assert.equal(restored.id, oldHost); assert.equal(restored.score, 0);
  assert.deepEqual(room.progress[oldHost], { explained: 0, guessed: 0 });
});
test('returning below three players resumes the paused game and retains earned turns', () => {
  const room = setup(3); finishTurn(room); act(room, 'host', 'next', {}, 1003);
  const guest = room.players[1], progress = structuredClone(room.progress[guest.id]);
  act(room, guest.token, 'leave', {}, 1004); assert.equal(room.phase, 'paused');
  joinRoom(room, newPlayer(guest.name, 'return-token'), 1005);
  assert.equal(room.phase, 'mining'); assert.equal(room.players.length, 3);
  assert.deepEqual(room.progress[guest.id], progress); assert.equal(view(room, 'return-token').players.find(p => p.id === guest.id).score, 1);
});
test('restoring a departed player still respects capacity and retains their saved state if full', () => {
  const room = setup(); const guest = room.players[1]; act(room, guest.token, 'leave', {}, 1001);
  joinRoom(room, newPlayer('Replacement', 'replacement'), 1002);
  assert.throws(() => joinRoom(room, newPlayer(guest.name, 'return-token'), 1003), /заполнена/);
  assert.equal(room.departed[0].player.id, guest.id);
  act(room, 'replacement', 'leave', {}, 1004);
  assert.equal(joinRoom(room, newPlayer(guest.name, 'return-token'), 1005).id, guest.id);
});
test('older rooms without saved players support reconnecting existing nicknames', () => {
  const room = setup(); delete room.departed;
  joinRoom(room, newPlayer('HOST', 'reconnected'), 1001);
  assert.equal(room.players.length, 4); assert.equal(view(room, 'reconnected').me, room.hostId);
  assert.deepEqual(room.departed, []); assert.equal(tick(room, 1002), false);
});

function memoryStore() {
  const records = new Map();
  return {
    async create(room) { if (records.has(room.code)) return false; records.set(room.code, { room: structuredClone(room), version: 0, updated: Date.now() }); return true; },
    async get(code) { return structuredClone(records.get(code)); },
    async save(room, version, now) { if (records.get(room.code).version !== version) return false; records.set(room.code, { room: structuredClone(room), version: version + 1, updated: now }); return true; }
  };
}
async function call(store, path, data, token) {
  const response = await api(new Request('https://game.test' + path, { method: data ? 'POST' : 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {}, ...(data && { body: JSON.stringify(data) }) }), store);
  return { status: response.status, ...await response.json() };
}
test('API recovery uses only the nickname and returns a fresh token for the same player', async () => {
  const store = memoryStore(), original = await call(store, '/api/rooms', { name: 'Host' });
  const base = '/api/rooms/' + original.room.code;
  assert.equal((await call(store, base, null, original.token)).status, 200);
  const recovered = await call(store, base + '/join', { name: 'HOST' });
  assert.equal(recovered.status, 200); assert.equal(recovered.rejoined, true);
  assert.equal(recovered.room.me, original.room.me); assert.notEqual(recovered.token, original.token);
  assert.equal(recovered.room.players.length, 1);
  assert.equal((await call(store, base, null, original.token)).status, 401);
  assert.equal((await call(store, base, null, recovered.token)).status, 200);
});
test('all players may leave and rejoin the empty room with the same nicknames', async () => {
  const store = memoryStore(), host = await call(store, '/api/rooms', { name: 'Host' });
  const base = '/api/rooms/' + host.room.code;
  await call(store, base + '/action', { action: 'leave' }, host.token);
  const restored = await call(store, base + '/join', { name: 'host' });
  assert.equal(restored.status, 200); assert.equal(restored.rejoined, true); assert.equal(restored.room.me, host.room.me);
  assert.equal(restored.room.hostId, host.room.me); assert.equal(restored.room.players.length, 1);
});
test('concurrent same-nickname reconnects never create a duplicate player', async () => {
  const store = memoryStore(), host = await call(store, '/api/rooms', { name: 'Host' });
  const base = '/api/rooms/' + host.room.code;
  const reconnects = await Promise.all(Array.from({ length: 8 }, () => call(store, base + '/join', { name: 'HOST' })));
  assert.ok(reconnects.every(r => r.status === 200 && r.rejoined && r.room.me === host.room.me));
  const final = await store.get(host.room.code); assert.equal(final.room.players.length, 1);
  assert.equal(final.room.players[0].id, host.room.me);
  const sessions = await Promise.all(reconnects.map(r => call(store, base, null, r.token)));
  assert.equal(sessions.filter(r => r.status === 200).length, 1);
});
