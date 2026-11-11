import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DICTIONARIES } from '../src/words.js';
import { createRoom, newPlayer, joinRoom, act, tick, view, settings, normalize } from '../src/game.js';
import { messages, errorMessages } from '../public/i18n.js';
import { renderScoreboard } from '../public/scoreboard.js';

function roomFor(language) {
  const room = createRoom('001234', newPlayer('Host', 'host'), { wordLanguage: language }, 1000);
  joinRoom(room, newPlayer('Guest', 'guest'), 1000);
  joinRoom(room, newPlayer('Miner', 'miner'), 1000);
  return room;
}

test('each language has 500 distinct playable words', () => {
  for (const words of Object.values(DICTIONARIES)) {
    assert.equal(words.length, 500);
    assert.equal(new Set(words.map(normalize)).size, 500);
    assert.ok(words.every(word => word === word.trim() && word.length > 0 && word.length <= 60 && !word.includes('_')));
  }
});

test('room language determines the shared secret while preserving guesser privacy', () => {
  for (const language of ['ru', 'en', 'kk']) {
    const room = roomFor(language);
    act(room, 'host', 'start', {}, 1000);
    assert.ok(DICTIONARIES[language].includes(room.round.word));
    const guest = view(room, 'guest', 1000);
    assert.equal(guest.round.word, null);
    assert.equal(guest.settings.wordLanguage, language);
    assert.deepEqual(guest.settings.wordCounts, { ru: 500, en: 500, kk: 500 });
    const secret = room.round.word;
    tick(room, room.round.deadline);
    act(room, 'guest', 'guess', { word: secret.toUpperCase() }, 62000);
    assert.equal(room.phase, 'result');
    assert.equal(view(room, 'guest').round.word, secret);
    assert.deepEqual(room.players.map(p => p.score), [1, 1, 0]);
  }
});

test('host can choose the dictionary in the lobby and custom-only words remain supported', () => {
  const room = roomFor('ru');
  assert.throws(() => act(room, 'guest', 'settings', { wordLanguage: 'kk' }, 1000));
  act(room, 'host', 'settings', { wordLanguage: 'kk' }, 1000);
  act(room, 'host', 'start', {}, 1000);
  assert.ok(DICTIONARIES.kk.includes(room.round.word));
  assert.throws(() => act(room, 'host', 'settings', { wordLanguage: 'en' }, 1000));
  act(room, 'host', 'lobby', {}, 1000);
  act(room, 'host', 'settings', { wordLanguage: 'en', useDefaultWords: false, customWords: 'Custom phrase' }, 1000);
  act(room, 'host', 'start', {}, 1000);
  assert.equal(room.round.word, 'Custom phrase');
  assert.equal(settings().wordLanguage, 'ru');
  for (const value of ['de', '__proto__', 'constructor', {}, true]) assert.throws(() => settings({ wordLanguage: value }));
});

test('older saved rooms without a language retain the Russian dictionary', () => {
  const room = roomFor('ru');
  delete room.settings.wordLanguage;
  act(room, 'host', 'start', {}, 1000);
  assert.ok(DICTIONARIES.ru.includes(room.round.word));
  assert.equal(view(room, 'host').settings.wordLanguage, 'ru');
});

test('translations cover the same strings and placeholders in all three languages', () => {
  const keys = Object.keys(messages.ru).sort();
  for (const language of ['en', 'kk']) {
    assert.deepEqual(Object.keys(messages[language]).sort(), keys);
    for (const key of keys) {
      assert.ok(messages[language][key].trim(), `${language}.${key}`);
      const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
      assert.deepEqual(placeholders(messages[language][key]), placeholders(messages.ru[key]), `${language}.${key}`);
    }
  }
});

test('locale defaults to Russian, persists explicit choices, and rejects unsupported saved values', async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  globalThis.document = { documentElement: {} };
  globalThis.window = { dispatchEvent() {} };
  try {
    const locale = await import('../public/i18n.js?default-test');
    assert.equal(locale.getLanguage(), 'ru');
    locale.setLanguage('kk');
    assert.equal(locale.getLanguage(), 'kk');
    assert.equal(document.documentElement.lang, 'kk');
    assert.equal(locale.t('turn', { current: 2, total: 6 }), 'Жүріс 2 / 6');
    assert.equal(locale.translateError('Комната не найдена.'), 'Бөлме табылмады.');
    const restored = await import('../public/i18n.js?restored-test');
    assert.equal(restored.getLanguage(), 'kk');
    restored.setLanguage('__proto__');
    assert.equal(restored.getLanguage(), 'kk');
    storage.set('word-mine-language', '__proto__');
    const invalid = await import('../public/i18n.js?invalid-test');
    assert.equal(invalid.getLanguage(), 'ru');
    invalid.setLanguage('en');
    assert.equal(invalid.t('winner', { name: 'Айдана' }), 'Winner: Айдана');
    assert.equal(invalid.translateError('Имя должно содержать от 1 до 24 символов.'), 'Your name must contain 1 to 24 characters.');
  } finally {
    delete globalThis.localStorage; delete globalThis.document; delete globalThis.window;
  }
});

test('API validation and game errors have English and Kazakh translations', async () => {
  const sources = await Promise.all(['../src/api.js', '../src/game.js'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  const translated = new Set(errorMessages.map(([ru]) => ru));
  for (const source of sources) {
    // Fixed Russian error messages; the two parameterized numeric limits are covered separately.
    const errors = [...source.matchAll(/'([^'\n]*[А-Яа-яЁё][^'\n]*[.!])'/g)].map(m => m[1]);
    for (const error of errors) assert.ok(translated.has(error), error);
  }
});

test('scoreboard sorts scores, shares tied ranks, identifies the player and escapes names', () => {
  const players = [
    { id: 'a', name: 'Low', score: 1 },
    { id: 'b', name: '<img src=x onerror=alert(1)>', score: 5 },
    { id: 'c', name: 'Айдана', score: 5 }
  ];
  for (const lang of ['ru', 'en', 'kk']) {
    const m = messages[lang];
    const html = renderScoreboard(players, 'c', { title: m.scoreboard, place: m.place, player: m.player, score: m.score, you: m.you });
    assert.ok(html.includes(`<caption>${m.scoreboard}</caption>`));
    assert.ok(html.indexOf('Айдана') < html.indexOf('Low'));
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.ok(!html.includes('<img'));
    assert.match(html, /class="is-you"><td>1<\/td>/);
    assert.match(html, /<td>3<\/td><th scope="row">Low/);
    assert.equal((html.match(/<td>1<\/td>/g)||[]).length, 2);
    assert.deepEqual(players.map(p => p.id), ['a','b','c']);
  }
});
