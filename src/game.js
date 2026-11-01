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
  return { capacity, duration: integer(input.duration ?? 90, 15, 600, 'Время хода'), miningDuration: integer(input.miningDuration ?? 60, 15, 300, 'Время минирования'), cycles: integer(input.cycles ?? 1, 1, 20, 'Количество кругов'), customWords, useDefaultWords };
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
  return { code, hostId: player.id, players: [player], settings: settings(input), phase: 'lobby', turn: 0, totalTurns: 0, round: null, used: [], updated: now };
}
export function joinRoom(room, player) {
  requireThat(room.phase === 'lobby', 'Игра уже идёт. Дождитесь возвращения в лобби.');
  requireThat(!room.settings.capacity || room.players.length < room.settings.capacity, 'Комната заполнена. Попросите ведущего увеличить размер.');
  requireThat(!room.players.some(p => normalize(p.name) === normalize(player.name)), 'Это имя уже занято. Выберите другое.');
  room.players.push(player);
}
function startTurn(room, now) {
  const n = room.players.length;
  const words = [...(room.settings.useDefaultWords ? WORDS : []), ...room.settings.customWords];
  let available = words.filter(w => !room.used.includes(w));
  if (!available.length) { room.used = []; available = words; }
  const word = available[crypto.getRandomValues(new Uint32Array(1))[0] % available.length];
  room.used.push(word);
  room.round = {
    word, explainerId: room.players[room.turn % n].id,
    guesserId: room.players[(room.turn + 1) % n].id,
    mines: {}, deadline: now + room.settings.miningDuration * 1000,
    claim: null, result: null, lastGuess: ''
  };
  room.phase = 'mining';
}
function startExplaining(room, now) {
  room.phase = 'explaining';
  room.round.deadline = now + room.settings.duration * 1000;
}
function finish(room, outcome, winnerIds = [], mine = null) {
  for (const p of room.players) if (winnerIds.includes(p.id)) p.score++;
  room.round.result = { outcome, winnerIds, mine };
  room.round.deadline = null;
  room.round.claim = null;
  room.phase = 'result';
}
export function tick(room, now) {
  let changed = false;
  if (room.phase === 'mining' && now >= room.round.deadline) { startExplaining(room, room.round.deadline); changed = true; }
  if (room.phase === 'explaining' && now >= room.round.deadline) { finish(room, 'timeout'); changed = true; }
  return changed;
}
export function act(room, token, action, data = {}, now = Date.now()) {
  const p = room.players.find(p => p.token === token);
  requireThat(p, 'Вы вышли из комнаты. Войдите снова.', 401);
  const host = p.id === room.hostId;
  const onlyHost = () => requireThat(host, 'Это действие доступно ведущему.', 403);
  tick(room, now);
  if (action === 'ready') {
    requireThat(room.phase === 'lobby', 'Игра уже началась.'); p.ready = !p.ready;
  } else if (action === 'settings') {
    onlyHost(); requireThat(room.phase === 'lobby', 'Настройки доступны в лобби.');
    room.settings = settings(data, room.players.length);
    room.players.forEach(player => { player.ready = false; });
  } else if (action === 'start') {
    onlyHost(); requireThat(room.phase === 'lobby', 'Игра уже началась.');
    requireThat(room.players.length >= 3, 'Для игры нужны хотя бы 3 игрока.');
    requireThat(room.players.every(p => p.ready), 'Дождитесь готовности всех игроков.');
    room.players.forEach(p => { p.score = 0; }); room.turn = 0;
    room.totalTurns = room.players.length * room.settings.cycles; room.used = [];
    startTurn(room, now);
  } else if (action === 'mine') {
    requireThat(room.phase === 'mining', 'Минирование уже завершено.');
    requireThat(p.id !== room.round.explainerId && p.id !== room.round.guesserId, 'Мины устанавливают только минёры.', 403);
    const word = String(data.word || '').trim();
    requireThat(/^[\p{L}\p{N}-]{2,40}$/u.test(word), 'Мина — одно слово от 2 до 40 букв, без пробелов.');
    requireThat(normalize(word) !== normalize(room.round.word), 'Секретное слово не может быть миной.');
    requireThat(!room.round.mines[p.id], 'Ваша мина уже установлена.');
    room.round.mines[p.id] = word;
    if (Object.keys(room.round.mines).length === room.players.length - 2) startExplaining(room, now);
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
    room.round.claim = { playerId: p.id, word: room.round.mines[p.id], remaining: Math.max(0, room.round.deadline - now) };
    room.phase = 'claim'; room.round.deadline = null;
  } else if (action === 'resolve') {
    onlyHost(); requireThat(room.phase === 'claim', 'Нет заявки на подрыв.');
    if (data.accept === true) {
      const mine = room.round.claim.word;
      const winners = Object.entries(room.round.mines).filter(([, w]) => normalize(w) === normalize(mine)).map(([id]) => id);
      finish(room, 'exploded', winners, mine);
    } else {
      room.round.deadline = now + room.round.claim.remaining; room.round.claim = null; room.phase = 'explaining';
    }
  } else if (action === 'skip') {
    onlyHost(); requireThat(['mining', 'explaining', 'claim'].includes(room.phase), 'Нет активного хода.');
    finish(room, 'skipped');
  } else if (action === 'next') {
    onlyHost(); requireThat(room.phase === 'result', 'Сначала завершите ход.');
    room.turn++;
    if (room.turn >= room.totalTurns) room.phase = 'finished';
    else startTurn(room, now);
  } else if (action === 'lobby') {
    onlyHost(); requireThat(room.phase !== 'lobby', 'Вы уже в лобби.'); resetLobby(room);
  } else if (action === 'leave' || action === 'kick') {
    if (action === 'kick') onlyHost();
    const id = action === 'leave' ? p.id : data.playerId;
    requireThat(action !== 'kick' || id !== p.id, 'Для выхода используйте кнопку «Выйти».');
    requireThat(room.players.some(p => p.id === id), 'Игрок не найден.');
    room.players = room.players.filter(p => p.id !== id);
    if (room.hostId === id) room.hostId = room.players[0]?.id ?? null;
    if (room.phase !== 'lobby') resetLobby(room);
  } else throw new GameError('Неизвестное действие.');
  room.updated = now;
  return p;
}
function resetLobby(room) {
  room.phase = 'lobby'; room.round = null;
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
    players: room.players.map(({ token, ...player }) => player),
    settings: { ...room.settings, customWords: p.id === room.hostId && room.phase === 'lobby' ? room.settings.customWords.join('\n') : '', customCount: room.settings.customWords.length },
    turn: room.turn, totalTurns: room.totalTurns, serverNow: now,
    round: r && { role, explainerId: r.explainerId, guesserId: r.guesserId,
      word: role !== 'guesser' || reveal ? r.word : null,
      mineCount: Object.keys(r.mines).length, myMine: r.mines[p.id] || null,
      mines: reveal ? r.mines : null, deadline: r.deadline,
      claim: r.claim && { playerId: r.claim.playerId, word: r.claim.word }, result: r.result, lastGuess: r.lastGuess }
  };
}
