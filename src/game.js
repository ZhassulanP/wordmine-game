import { WORDS } from './words.js';

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const normalize = value => String(value ?? '').trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
const requireThat = (condition, message, status) => { if (!condition) throw new GameError(message, status); };
const integer = (value, min, max, label) => {
  const n = Number(value);
  requireThat(Number.isSafeInteger(n) && n >= min && n <= max, `${label}: от ${min} до ${max}.`);
  return n;
};
export function settings(input = {}, count = 0) {
  const capacity = input.capacity === '' || input.capacity == null || input.capacity === 0 ? null : integer(input.capacity, 3, 1000000, 'Число игроков');
  requireThat(!capacity || capacity >= count, 'В комнате уже больше игроков.');
  const customWords = [...new Set(String(input.customWords || '').split(/[\n,;]/).map(w => w.trim()).filter(Boolean))];
  requireThat(customWords.length <= 1000 && customWords.every(w => w.length <= 60), 'До 1000 своих слов, каждое до 60 символов.');
  const useDefaultWords = input.useDefaultWords !== false;
  requireThat(useDefaultWords || customWords.length > 0, 'Добавьте свои слова или включите встроенный словарь.');
  return { capacity, duration: null, miningDuration: 60, cycles: integer(input.cycles ?? 1, 1, 20, 'Количество кругов'), customWords, useDefaultWords };
}
export function checkPassword(password) {
  requireThat(typeof password === 'string' && password.toLowerCase() === 'acm', 'Неверный пароль комнаты.', 403);
}
export function newPlayer(name, token) {
  name = String(name || '').trim();
  requireThat(name.length >= 1 && name.length <= 24, 'Имя должно содержать от 1 до 24 символов.');
  return { id: crypto.randomUUID(), token, name, ready: false, score: 0 };
}
export function createRoom(code, player, input, now) {
  return { code, hostId: player.id, players: [player], settings: settings(input), phase: 'lobby', turn: 0, totalTurns: 0, round: null, used: [], departed: [], progress: { [player.id]: { explained: 0, guessed: 0 } }, schedule: [], updated: now };
}
export function joinRoom(room, player, now = Date.now()) {
  const existing = room.players.find(p => normalize(p.name) === normalize(player.name));
  if (existing) {
    tick(room, now);
    existing.token = player.token;
    room.updated = now;
    return existing;
  }
  requireThat(!room.settings.capacity || room.players.length < room.settings.capacity, 'Комната заполнена. Попросите ведущего увеличить размер.');
  tick(room, now);
  const saved = room.departed.find(entry => normalize(entry.player.name) === normalize(player.name));
  const joined = saved ? { ...saved.player, token: player.token, ready: false } : player;
  room.players.push(joined);
  room.progress[joined.id] = saved ? { ...saved.progress } : { explained: 0, guessed: 0 };
  room.departed = room.departed.filter(entry => entry.player.id !== joined.id);
  if (!room.hostId) room.hostId = joined.id;
  if (room.round) room.round.names[joined.id] = joined.name;
  if (!['lobby', 'finished'].includes(room.phase)) {
    rebuildSchedule(room);
    if (room.phase === 'paused' && room.players.length >= 3) startTurn(room, now);
  }
  room.updated = now;
  return joined;
}
const activePhases = ['mining', 'explaining', 'claim'];
function rebuildSchedule(room) {
  const counts = structuredClone(room.progress);
  if (room.round && activePhases.includes(room.phase)) {
    counts[room.round.explainerId].explained++;
    counts[room.round.guesserId].guessed++;
  }
  const target = room.settings.cycles;
  const ids = room.players.map(p => p.id);
  const total = id => counts[id].explained + counts[id].guessed;
  room.schedule = [];
  // Every planned turn fills at least one missing role. Extra partner turns
  // are allowed when departures leave unequal numbers of the two roles.
  while (ids.length >= 3 && ids.some(id => counts[id].explained < target || counts[id].guessed < target)) {
    const byRole = role => [...ids].sort((a, b) => counts[a][role] - counts[b][role] || total(a) - total(b));
    const explainers = byRole('explained'), guessers = byRole('guessed');
    const e = explainers[0], g = guessers[0];
    const pairs = e !== g ? [[e, g]] : [[e, guessers[1]], [explainers[1], g]];
    const deficit = ([a, b]) => Number(counts[a].explained < target) + Number(counts[b].guessed < target);
    pairs.sort((a, b) => deficit(b) - deficit(a) ||
      (counts[a[0]].explained + counts[a[1]].guessed) - (counts[b[0]].explained + counts[b[1]].guessed) ||
      (total(a[0]) + total(a[1])) - (total(b[0]) + total(b[1])));
    const [explainerId, guesserId] = pairs[0];
    room.schedule.push({ explainerId, guesserId });
    counts[explainerId].explained++; counts[guesserId].guessed++;
  }
  room.totalTurns = room.turn + (room.round ? 1 : 0) + room.schedule.length;
}
function ensureState(room) {
  let changed = false;
  if (!room.departed) { room.departed = []; changed = true; }
  if (!room.progress) {
    room.progress = Object.fromEntries(room.players.map(p => [p.id, { explained: 0, guessed: 0 }]));
    // Older rooms used a fixed cyclic schedule. Preserve their completed roles.
    const completed = room.phase === 'finished' ? room.turn : room.turn + Number(room.phase === 'result');
    for (let i = 0; room.players.length && i < completed; i++) {
      room.progress[room.players[i % room.players.length].id].explained++;
      room.progress[room.players[(i + 1) % room.players.length].id].guessed++;
    }
    changed = true;
  }
  if (!room.schedule) { room.schedule = []; changed = true; }
  if (room.round && !room.round.id) {
    room.round.id = crypto.randomUUID();
    room.round.names = Object.fromEntries(room.players.map(p => [p.id, p.name]));
    changed = true;
  }
  if (changed && !['lobby', 'finished'].includes(room.phase)) rebuildSchedule(room);
  return changed;
}
function startTurn(room, now) {
  if (room.players.length < 3) { room.phase = 'paused'; room.round = null; return; }
  const pair = room.schedule.shift();
  if (!pair) { room.phase = 'finished'; room.round = null; return; }
  const words = [...(room.settings.useDefaultWords ? WORDS : []), ...room.settings.customWords];
  let available = words.filter(w => !room.used.includes(w));
  if (!available.length) { room.used = []; available = words; }
  if (room.avoidWord && available.some(w => w !== room.avoidWord)) available = available.filter(w => w !== room.avoidWord);
  const word = available[crypto.getRandomValues(new Uint32Array(1))[0] % available.length];
  delete room.avoidWord;
  room.used.push(word);
  room.round = {
    id: crypto.randomUUID(), names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
    word, ...pair,
    mines: {}, deadline: now + 60000,
    claim: null, result: null, lastGuess: ''
  };
  room.phase = 'mining';
}
function startExplaining(room) {
  room.phase = 'explaining';
  room.round.deadline = null;
}
function finish(room, outcome, winnerIds = [], mine = null) {
  for (const p of room.players) if (winnerIds.includes(p.id)) p.score++;
  room.round.result = { outcome, winnerIds, mine };
  room.round.deadline = null;
  room.round.claim = null;
  room.phase = 'result';
  room.progress[room.round.explainerId].explained++;
  room.progress[room.round.guesserId].guessed++;
  rebuildSchedule(room);
}
export function tick(room, now) {
  let changed = ensureState(room);
  // Apply the current timing rules to rooms saved before this update as well.
  if (room.settings.duration !== null || room.settings.miningDuration !== 60) {
    if (room.phase === 'mining') room.round.deadline += (60 - room.settings.miningDuration) * 1000;
    room.settings.duration = null; room.settings.miningDuration = 60; changed = true;
  }
  if (room.phase === 'explaining' && room.round.deadline !== null) { room.round.deadline = null; changed = true; }
  if (room.phase === 'mining' && now >= room.round.deadline) { startExplaining(room); changed = true; }
  return changed;
}
export function act(room, token, action, data = {}, now = Date.now()) {
  const p = room.players.find(p => p.token === token);
  requireThat(p, 'Вы вышли из комнаты. Войдите снова.', 401);
  const host = p.id === room.hostId;
  const onlyHost = () => requireThat(host, 'Это действие доступно ведущему.', 403);
  tick(room, now);
  if (['mine', 'guess', 'guessed', 'claim', 'resolve', 'skip', 'next'].includes(action) && data.roundId != null) {
    requireThat(data.roundId === room.round?.id, 'Этот ход уже сменился. Дождитесь обновления экрана.', 409);
  }
  if (action === 'ready') {
    requireThat(room.phase === 'lobby', 'Игра уже началась.'); p.ready = !p.ready;
  } else if (action === 'settings') {
    onlyHost(); requireThat(room.phase === 'lobby', 'Настройки доступны в лобби.');
    room.settings = settings(data, room.players.length);
    room.players.forEach(player => { player.ready = false; });
  } else if (action === 'start') {
    onlyHost(); requireThat(room.phase === 'lobby', 'Игра уже началась.');
    requireThat(room.players.length >= 3, 'Для игры нужны хотя бы 3 игрока.');
    room.players.forEach(p => { p.score = 0; }); room.turn = 0;
    room.departed.forEach(entry => { entry.player.score = 0; entry.progress = { explained: 0, guessed: 0 }; });
    room.progress = Object.fromEntries(room.players.map(p => [p.id, { explained: 0, guessed: 0 }]));
    room.round = null; room.used = []; rebuildSchedule(room);
    startTurn(room, now);
  } else if (action === 'mine') {
    requireThat(room.phase === 'mining', 'Минирование уже завершено.');
    requireThat(p.id !== room.round.explainerId && p.id !== room.round.guesserId, 'Мины устанавливают только минёры.', 403);
    const word = String(data.word || '').trim();
    requireThat(word.length >= 1 && word.length <= 20, 'Мина — от 1 до 20 символов, включая пробелы.');
    requireThat(normalize(word) !== normalize(room.round.word), 'Секретное слово не может быть миной.');
    requireThat(!room.round.mines[p.id], 'Ваша мина уже установлена.');
    room.round.mines[p.id] = word;
    if (Object.keys(room.round.mines).length === room.players.length - 2) startExplaining(room);
  } else if (action === 'guess') {
    requireThat(room.phase === 'explaining', 'Сейчас нельзя отправить ответ.');
    requireThat(p.id === room.round.guesserId, 'Ответ отправляет угадывающий.', 403);
    const guess = String(data.word || '').trim();
    requireThat(guess.length > 0 && guess.length <= 60, 'Введите ответ до 60 символов.');
    if (normalize(guess) === normalize(room.round.word)) finish(room, 'guessed', [room.round.explainerId, room.round.guesserId]);
    else room.round.lastGuess = guess;
  } else if (action === 'guessed') {
    requireThat(room.phase === 'explaining', 'Ход уже завершён.');
    requireThat(host || p.id === room.round.explainerId, 'Подтвердить ответ может объясняющий или ведущий.', 403);
    finish(room, 'guessed', [room.round.explainerId, room.round.guesserId]);
  } else if (action === 'claim') {
    requireThat(room.phase === 'explaining', 'Сейчас нельзя сообщить о мине.');
    requireThat(room.round.mines[p.id], 'Можно заявить только о своей мине.', 403);
    room.round.claim = { playerId: p.id, word: room.round.mines[p.id] };
    room.phase = 'claim'; room.round.deadline = null;
  } else if (action === 'resolve') {
    onlyHost(); requireThat(room.phase === 'claim', 'Нет заявки на подрыв.');
    if (data.accept === true) {
      const mine = room.round.claim.word;
      const winners = Object.entries(room.round.mines).filter(([, w]) => normalize(w) === normalize(mine)).map(([id]) => id);
      finish(room, 'exploded', winners, mine);
    } else {
      room.round.deadline = null; room.round.claim = null; room.phase = 'explaining';
    }
  } else if (action === 'skip') {
    onlyHost(); requireThat(['mining', 'explaining', 'claim'].includes(room.phase), 'Нет активного хода.');
    finish(room, 'skipped');
  } else if (action === 'next') {
    onlyHost(); requireThat(room.phase === 'result', 'Сначала завершите ход.');
    room.turn++;
    room.round = null; rebuildSchedule(room); startTurn(room, now);
  } else if (action === 'lobby') {
    onlyHost(); requireThat(room.phase !== 'lobby', 'Вы уже в лобби.'); resetLobby(room);
  } else if (action === 'leave' || action === 'kick') {
    if (action === 'kick') onlyHost();
    const id = action === 'leave' ? p.id : data.playerId;
    requireThat(action !== 'kick' || id !== p.id, 'Для выхода используйте кнопку «Выйти».');
    requireThat(room.players.some(p => p.id === id), 'Игрок не найден.');
    const { token: removedToken, ...savedPlayer } = room.players.find(p => p.id === id);
    room.departed = room.departed.filter(entry => entry.player.id !== id);
    room.departed.push({ player: { ...savedPlayer, ready: false }, progress: { ...room.progress[id] } });
    room.players = room.players.filter(p => p.id !== id);
    if (room.hostId === id) room.hostId = room.players[0]?.id ?? null;
    delete room.progress[id];
    if (!['lobby', 'finished'].includes(room.phase)) {
      if (room.players.length < 3) {
        if (room.phase === 'result') room.turn++;
        if (activePhases.includes(room.phase)) room.avoidWord = room.round.word;
        room.phase = 'paused'; room.round = null;
      } else if (activePhases.includes(room.phase)) {
        if ([room.round.explainerId, room.round.guesserId].includes(id)) {
          // A replacement guesser may have seen the old answer as a miner.
          // Restart with a fresh word rather than reusing the exposed answer.
          room.avoidWord = room.round.word; room.phase = 'paused'; room.round = null;
        } else {
          delete room.round.mines[id];
          if (room.round.claim?.playerId === id) { room.round.claim = null; startExplaining(room); }
          if (room.phase === 'mining' && Object.keys(room.round.mines).length === room.players.length - 2) startExplaining(room);
        }
      }
      rebuildSchedule(room);
      if (room.phase === 'paused' && room.players.length >= 3) startTurn(room, now);
    }
  } else throw new GameError('Неизвестное действие.');
  room.updated = now;
  return p;
}
function resetLobby(room) {
  room.phase = 'lobby'; room.round = null; room.schedule = [];
  room.players.forEach(p => { p.ready = false; });
}
export function view(room, token, now = Date.now()) {
  const p = room.players.find(p => p.token === token);
  requireThat(p, 'Вы вышли из комнаты. Войдите снова.', 401);
  const r = room.round;
  const role = !r ? null : p.id === r.explainerId ? 'explainer' : p.id === r.guesserId ? 'guesser' : 'miner';
  const reveal = ['result', 'finished'].includes(room.phase);
  return {
    code: room.code, me: p.id, hostId: room.hostId, phase: room.phase,
    players: room.players.map(({ token, ...player }) => ({ ...player, turnsExplained: room.progress?.[player.id]?.explained ?? 0, turnsGuessed: room.progress?.[player.id]?.guessed ?? 0 })),
    settings: { ...room.settings, customWords: p.id === room.hostId && room.phase === 'lobby' ? room.settings.customWords.join('\n') : '', customCount: room.settings.customWords.length },
    turn: room.turn, totalTurns: room.totalTurns, serverNow: now,
    round: r && { id: r.id, names: r.names, role, explainerId: r.explainerId, guesserId: r.guesserId,
      word: role !== 'guesser' || reveal ? r.word : null,
      mineCount: Object.keys(r.mines).length, myMine: r.mines[p.id] || null,
      mines: reveal || role === 'miner' ? r.mines : null, deadline: r.deadline,
      claim: r.claim && { playerId: r.claim.playerId, word: r.claim.word }, result: r.result, lastGuess: r.lastGuess }
  };
}
