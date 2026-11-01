import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createRoom, joinRoom, newPlayer, tick, view } from '../src/game.js';

function setup(count = 4, cycles = 1) {
  const host = newPlayer('Host', 'host');
  const room = createRoom('1234', host, { cycles, useDefaultWords: false, customWords: 'Самолёт, Корабль, Автобус' }, 1000);
  for (let i = 1; i < count; i++) joinRoom(room, newPlayer('Player ' + i, 'token-' + i), 1000);
  act(room, 'host', 'start', {}, 1000);
  return room;
}
const hostToken = room => room.players.find(p => p.id === room.hostId).token;
const miners = room => room.players.filter(p => ![room.round.explainerId, room.round.guesserId].includes(p.id));
function complete(room, now = 2000) {
  if (room.phase === 'mining') {
    for (const p of miners(room)) if (!room.round.mines[p.id]) act(room, p.token, 'mine', { word: 'ловушка' }, now);
  }
  assert.equal(room.phase, 'explaining');
  assert.ok(room.players.some(p => p.id === room.round.explainerId));
  assert.ok(room.players.some(p => p.id === room.round.guesserId));
  assert.notEqual(room.round.explainerId, room.round.guesserId);
  act(room, hostToken(room), 'guessed', {}, now);
  act(room, hostToken(room), 'next', {}, now);
}
function finishGame(room) {
  let turns = 0;
  while (room.phase !== 'finished' && turns++ < 500) complete(room, 3000 + turns);
  assert.equal(room.phase, 'finished', 'scheduler must finish and never strand a missing role');
  for (const p of room.players) {
    assert.ok(room.progress[p.id].explained >= room.settings.cycles, p.name + ' must explain enough times');
    assert.ok(room.progress[p.id].guessed >= room.settings.cycles, p.name + ' must guess enough times');
  }
  assert.equal(room.turn, room.totalTurns);
}
test('stable rosters get exactly one turn in each role per configured cycle', () => {
  for (let count = 3; count <= 12; count++) for (let cycles = 1; cycles <= 3; cycles++) {
    const room = setup(count, cycles); finishGame(room);
    assert.equal(room.turn, count * cycles);
    for (const p of room.players) assert.deepEqual(room.progress[p.id], { explained: cycles, guessed: cycles });
  }
});
test('a join during mining preserves the word, deadline and mines and adds balanced turns', () => {
  const room = setup(); const miner = miners(room)[0];
  act(room, miner.token, 'mine', { word: 'ловушка' }, 1001);
  const previous = structuredClone(room.round), previousTotal = room.totalTurns;
  const late = newPlayer('Late', 'late'); joinRoom(room, late, 1002);
  assert.equal(room.round.id, previous.id); assert.equal(room.round.word, previous.word);
  assert.equal(room.round.deadline, previous.deadline); assert.deepEqual(room.round.mines, previous.mines);
  assert.ok(room.totalTurns > previousTotal);
  assert.equal(view(room, late.token).round.role, 'miner');
  assert.equal(view(room, late.token).round.mines[miner.id], 'ловушка');
  act(room, late.token, 'mine', { word: 'небо' }, 1003);
  finishGame(room);
});
test('joins during guessing or a claim never restart the turn or become the current guesser', () => {
  for (const phase of ['explaining', 'claim', 'result']) {
    const room = setup();
    for (const p of miners(room)) act(room, p.token, 'mine', { word: 'ловушка' }, 1001);
    if (phase === 'claim') act(room, miners(room)[0].token, 'claim', {}, 1002);
    if (phase === 'result') act(room, 'host', 'guessed', {}, 1002);
    const roundId = room.round.id, score = room.players[0].score;
    joinRoom(room, newPlayer('Late', 'late'), 1003);
    assert.equal(room.round.id, roundId); assert.equal(room.phase, phase);
    assert.equal(view(room, 'late').round.role, 'miner'); assert.equal(view(room, 'late').round.myMine, null);
    assert.equal(room.players[0].score, score);
    if (phase === 'claim') act(room, 'host', 'resolve', { accept: false }, 1004);
    if (phase === 'result') act(room, 'host', 'next', {}, 1004);
    finishGame(room);
  }
});
test('kicking an unsubmitted miner continues when the remaining mines are ready', () => {
  const room = setup(); const [a, b] = miners(room); const roundId = room.round.id;
  act(room, a.token, 'mine', { word: 'ловушка' }, 1001);
  act(room, 'host', 'kick', { playerId: b.id }, 1002);
  assert.equal(room.round.id, roundId); assert.equal(room.phase, 'explaining');
  assert.deepEqual(room.round.mines, { [a.id]: 'ловушка' });
  assert.throws(() => view(room, b.token)); finishGame(room);
});
test('removing a miner deletes their mine and clears their pending claim', () => {
  const room = setup(5); const [a, b] = miners(room);
  for (const p of miners(room)) act(room, p.token, 'mine', { word: 'ловушка' }, 1001);
  act(room, a.token, 'claim', {}, 1002); const roundId = room.round.id;
  act(room, 'host', 'kick', { playerId: a.id }, 1003);
  assert.equal(room.phase, 'explaining'); assert.equal(room.round.id, roundId);
  assert.equal(room.round.claim, null); assert.equal(room.round.deadline, null);
  assert.equal(room.round.mines[a.id], undefined); assert.equal(room.round.mines[b.id], 'ловушка');
  finishGame(room);
});
test('removing either active player restarts with a fresh word and preserves scores and roles played', () => {
  for (const role of ['explainerId', 'guesserId']) for (const phase of ['mining', 'explaining', 'claim']) {
    const room = setup(5, 2); complete(room);
    if (phase !== 'mining') for (const p of miners(room)) act(room, p.token, 'mine', { word: 'ловушка' }, 2100);
    if (phase === 'claim') act(room, miners(room)[0].token, 'claim', {}, 2101);
    const old = structuredClone(room.round), progress = structuredClone(room.progress);
    const scores = Object.fromEntries(room.players.map(p => [p.id, p.score]));
    const departing = room.players.find(p => p.id === old[role]);
    // The host may itself be the selected active player.
    act(room, departing.token, 'leave', {}, 2200);
    assert.equal(room.phase, 'mining'); assert.notEqual(room.round.id, old.id);
    assert.notEqual(room.round.word, old.word); assert.deepEqual(room.round.mines, {});
    assert.equal(room.round.deadline, 62200);
    for (const p of room.players) { assert.equal(p.score, scores[p.id]); assert.deepEqual(room.progress[p.id], progress[p.id]); }
    const newMiner = miners(room)[0];
    assert.throws(() => act(room, newMiner.token, 'mine', { word: 'ловушка', roundId: old.id }, 2201), /ход уже сменился/);
    finishGame(room);
  }
});
test('the host can kick an active guesser without resetting the game to the lobby', () => {
  const room = setup(4, 2); const old = room.round.id;
  act(room, 'host', 'kick', { playerId: room.round.guesserId }, 1001);
  assert.equal(room.phase, 'mining'); assert.notEqual(room.round.id, old); assert.equal(room.players.length, 3);
  finishGame(room);
});
test('below three players pauses, then joining resumes with preserved scores', () => {
  const room = setup(3, 2); complete(room); const scores = Object.fromEntries(room.players.map(p => [p.id, p.score]));
  const remainingProgress = structuredClone(room.progress);
  act(room, room.players[1].token, 'leave', {}, 2100);
  assert.equal(room.phase, 'paused'); assert.equal(room.round, null);
  for (const p of room.players) { assert.equal(p.score, scores[p.id]); assert.deepEqual(room.progress[p.id], remainingProgress[p.id]); }
  joinRoom(room, newPlayer('New', 'new'), 2200);
  assert.equal(room.phase, 'mining'); assert.equal(room.round.deadline, 62200);
  finishGame(room);
});
test('pausing on a completed result counts that turn only once', () => {
  const room = setup(3); for (const p of miners(room)) act(room, p.token, 'mine', { word: 'ловушка' }, 1001);
  act(room, 'host', 'guessed', {}, 1002);
  const departing = room.players.find(p => p.id !== room.hostId && p.id !== room.round.guesserId);
  act(room, departing.token, 'leave', {}, 1003);
  assert.equal(room.phase, 'paused'); assert.equal(room.turn, 1);
  joinRoom(room, newPlayer('New', 'new'), 1004); finishGame(room);
});
test('a late player still gets both roles even when all other quotas are completed', () => {
  const room = setup(3);
  while (room.schedule.length) complete(room);
  for (const p of miners(room)) act(room, p.token, 'mine', { word: 'ловушка' }, 4000);
  act(room, 'host', 'guessed', {}, 4001);
  assert.ok(room.players.every(p => room.progress[p.id].explained >= 1 && room.progress[p.id].guessed >= 1));
  joinRoom(room, newPlayer('Very late', 'late'), 4002);
  act(room, 'host', 'next', {}, 4003); finishGame(room);
});
test('legacy rooms retain roles already completed when adopting dynamic scheduling', () => {
  const room = setup(4, 2);
  delete room.progress; delete room.schedule; delete room.round.id; delete room.round.names;
  room.turn = 2; room.round.explainerId = room.players[2].id; room.round.guesserId = room.players[3].id;
  assert.equal(tick(room, 1001), true);
  assert.deepEqual(room.progress[room.players[0].id], { explained: 1, guessed: 0 });
  assert.deepEqual(room.progress[room.players[1].id], { explained: 1, guessed: 1 });
  assert.deepEqual(room.progress[room.players[2].id], { explained: 0, guessed: 1 });
  finishGame(room);
});
test('repeated roster changes preserve completed roles and still finish fairly', () => {
  for (let count = 3; count <= 9; count++) {
    const room = setup(count, 3);
    for (let turn = 0; turn < 5; turn++) {
      complete(room, 5000 + turn * 10);
      joinRoom(room, newPlayer('Late ' + turn, 'late-' + turn), 5001 + turn * 10);
      const remove = turn % 2 === 0 ? miners(room)[0] : room.players.find(p => p.id === room.round.guesserId);
      act(room, hostToken(room), remove.id === room.hostId ? 'leave' : 'kick', { playerId: remove.id }, 5002 + turn * 10);
      assert.notEqual(room.phase, 'lobby');
    }
    finishGame(room);
  }
});
