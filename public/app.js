const $ = selector => document.querySelector(selector);
const app = $('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  talk: '<path d="M5 5h22v16H15l-7 6v-6H5z"/><path d="M11 11h10m-10 5h6"/>',
  mine: '<circle cx="16" cy="19" r="10"/><path d="M20 9c0-7 8-1 8-7M27 2l2-2M12 15l-2 3"/>',
  guess: '<path d="M10 20c-8-10 12-19 15-7 1 4-3 5-5 7l-1 4h-7zM12 28h7m-14-15H1m28 0h3M7 4 4 1m22 3 3-3"/>'
};
const icon = (name, cls='role-icon') => `<svg class="${cls}" viewBox="0 0 33 33" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
let room = null, session = null, tab = new URLSearchParams(location.search).has('room') ? 'join' : 'create';
let busy = false, polling = false, connected = true, offset = 0, signature = '', toastTimeout;
const drafts = new Map();
try { session = JSON.parse(sessionStorage.getItem('acm-session')); } catch {}

function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
$('#rules-button').onclick = () => $('#rules').showModal();
$('#close-rules').onclick = () => $('#rules').close();
$('#rules').addEventListener('click', e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close(); } });

function entry() {
  const invite = new URLSearchParams(location.search).get('room') || '';
  const legacyInvite = /^[A-Z2-9]{6}$/.test(invite.toUpperCase());
  const codeLength = legacyInvite ? 6 : 4;
  app.innerHTML = `<section class="hero"><div class="hero-copy"><span class="eyebrow">СЛОВЕСНАЯ ИГРА С ПОДВОХОМ</span>${icon('mine','little-mine')}<h1>Одно слово.<br><em>Сотня ловушек.</em></h1><p class="hero-description">Объясни слово друзьям. Обойди их мины.<br>И постарайся не сказать лишнего.</p><div class="hero-tags"><span class="tag">От 3 игроков</span><span class="tag">Без лимита в 10</span><span class="tag">Вживую или онлайн</span></div></div>
  <div class="entry-card"><div class="card-top"><span class="mini-label">КОМПАНИЯ УЖЕ СОБИРАЕТСЯ</span><span class="acm-stamp">ACM ✳</span></div><div class="tabs" role="tablist" aria-label="Вход в игру"><button class="tab ${tab==='create'?'active':''}" role="tab" aria-selected="${tab==='create'}" data-tab="create">Создать комнату</button><button class="tab ${tab==='join'?'active':''}" role="tab" aria-selected="${tab==='join'}" data-tab="join">Присоединиться</button></div>
  <form id="entry-form" class="entry-form"><div class="field"><label for="name">Как тебя зовут?</label><input name="name" id="name" placeholder="Имя или классный ник" maxlength="24" autocomplete="nickname" required></div>
  ${tab==='create'?'<div class="field"><label for="capacity">Сколько будет игроков?</label><input id="capacity" name="capacity" type="number" min="3" max="1000000" step="1" placeholder="Без ограничений"><span class="field-help">Любое число от 3. Оставь пустым — места хватит всем.</span></div>':`<div class="field"><label for="code">Код комнаты</label><input id="code" name="code" placeholder="Например, 1234" value="${esc(invite.toUpperCase())}" minlength="${codeLength}" maxlength="${codeLength}" pattern="${legacyInvite?'[A-Za-z2-9]{6}':'[0-9]{4}'}" inputmode="${legacyInvite?'text':'numeric'}" spellcheck="false" required></div>`}
  <div class="field"><label for="password">Пароль компании</label><div class="password-wrap"><input id="password" name="password" type="password" placeholder="Тот самый пароль" autocomplete="current-password" required><button class="eye" type="button" aria-label="Показать пароль" id="toggle-password">◉</button></div><span class="field-help">Один для всех комнат. Спроси у организатора.</span></div><p class="error" id="entry-error" role="alert"></p><button class="primary full" type="submit">${tab==='create'?'Собрать компанию':'Войти в комнату'}<span class="button-arrow">→</span></button><p class="form-note">${tab==='join'?'Возвращаешься? Прежний ник восстановит твои очки и очередь.':'Без регистрации. Только ты и твои друзья.'}</p></form></div></section>
  <section class="how-section"><div class="section-caption"><span>ТРИ РОЛИ. ОДНА БОЛЬШАЯ ЛОВУШКА.</span></div><div class="roles-grid"><article class="role-card"><span class="step">01 / ОБЪЯСНЯЙ</span>${icon('talk')}<h3>Подбирай слова</h3><p>Ты знаешь ответ. Помоги напарнику угадать, не произнося само слово.</p></article><article class="role-card"><span class="step">02 / МИНИРУЙ</span>${icon('mine')}<h3>Думай на шаг вперёд</h3><p>Загадай слово, которое наверняка прозвучит. Это и будет твоя мина.</p></article><article class="role-card"><span class="step">03 / УГАДЫВАЙ</span>${icon('guess')}<h3>Лови ассоциации</h3><p>Найди ответ раньше, чем сработает ловушка. Роли меняются каждый ход.</p></article></div></section>`;
  try { $('#name').value = localStorage.getItem('acm-name') || ''; } catch {}
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { tab = button.dataset.tab; entry(); });
  $('#toggle-password').onclick = () => { const input = $('#password'); input.type = input.type === 'password' ? 'text' : 'password'; $('#toggle-password').setAttribute('aria-label', input.type === 'password' ? 'Показать пароль' : 'Скрыть пароль'); };
  $('#entry-form').onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const button = e.currentTarget.querySelector('[type=submit]'); button.disabled = true; busy = true; $('#entry-error').textContent = '';
    try {
      const result = await request(tab==='create'?'/api/rooms':`/api/rooms/${values.code.trim().toUpperCase()}/join`, {name:values.name,password:values.password,settings:{capacity:values.capacity}});
      session = {code:result.room.code,token:result.token};
      try { sessionStorage.setItem('acm-session', JSON.stringify(session)); localStorage.setItem('acm-name',values.name); } catch {}
      history.replaceState(null,'',`/?room=${session.code}`);
      accept(result.room);
      if(result.rejoined) toast('С возвращением! Твои очки и очередь сохранены.');
    } catch (e) { $('#entry-error').textContent = e.message; button.disabled = false; }
    finally { busy = false; }
  };
}
async function request(path, data) {
  const response = await fetch(path, { method:data ? 'POST':'GET', headers:{...(data && {'Content-Type':'application/json'}),...(session && {'Authorization':`Bearer ${session.token}`})}, ...(data && {body:JSON.stringify(data)}), signal:AbortSignal.timeout(12000) });
  let result;
  try { result = await response.json(); } catch { throw new Error('Сервер недоступен. Проверьте подключение.'); }
  if (!response.ok) { const error = new Error(result.error || 'Не удалось выполнить запрос.'); error.status = response.status; throw error; }
  return result;
}
function accept(next) {
  if (room && next.serverNow < room.serverNow) return;
  if (room && (room.phase !== next.phase || room.turn !== next.turn || room.round?.id !== next.round?.id)) drafts.clear();
  room = next; offset = next.serverNow - Date.now(); connected = true;
  const nextSignature = JSON.stringify({...next, serverNow:0});
  if (signature !== nextSignature) { signature = nextSignature; renderRoom(); }
  $('#connection')?.setAttribute('hidden',''); updateTimer();
}
const isHost = () => room.me === room.hostId;
const playerName = id => room.players.find(p => p.id === id)?.name || room.round?.names?.[id] || 'Игрок';
const me = () => room.players.find(p => p.id === room.me);
const roleNames = {explainer:'Объясняющий',guesser:'Угадывающий',miner:'Минёр'};
function roster() {
  return room.players.map(p => {
    const status=room.phase==='lobby'?(p.ready?'✓ Готов к игре':'В комнате'):room.phase==='paused'?'Ждёт игроков':room.phase==='finished'?'Игра завершена':p.id===room.round?.explainerId?'Объясняет':p.id===room.round?.guesserId?'Угадывает':'Минёр';
    return `<div class="player"><div class="avatar">${esc(p.name.slice(0,2).toUpperCase())}</div><div class="player-info"><div class="player-name">${esc(p.name)}${p.id===room.me?' <span class="muted small">(ты)</span>':''}</div><div class="player-status">${status}${p.id===room.hostId?' · ведущий':''}</div>${room.phase!=='lobby'?`<div class="player-status">Объяснял: ${p.turnsExplained} · Угадывал: ${p.turnsGuessed}</div>`:''}</div>${room.phase!=='lobby'?`<span class="score">${p.score}</span>`:''}${isHost()&&p.id!==room.me?`<button class="kick" data-kick="${p.id}" aria-label="Удалить игрока ${esc(p.name)}">✕</button>`:''}</div>`;
  }).join('');
}
function renderRoom() {
  const oldDetails = $('#advanced')?.open;
  const focused = document.activeElement?.id;
  const selection = document.activeElement && ['text','search'].includes(document.activeElement.type) ? document.activeElement.selectionStart : null;
  app.innerHTML = `<div class="room-top"><div><span class="eyebrow">${room.phase==='lobby'?'МЕСТО ВСТРЕЧИ':'СЛОВА-МИНЫ · ИГРА ИДЁТ'}</span><h1>${room.phase==='lobby'?'Свои люди — в сборе.':room.phase==='finished'?'Вот это была игра!':room.phase==='paused'?'Ждём ещё игроков':`Ход ${Math.min(room.turn+1,room.totalTurns)} <span class="muted">/ ${room.totalTurns}</span>`}</h1></div><div class="room-actions"><button class="secondary" id="invite-button">Пригласить друзей ↗</button><span class="room-code">${esc(room.code)}</span></div></div>
  <div class="connection" id="connection" ${connected?'hidden':''}>Связь прервалась. Переподключаемся… Действия будут доступны после подключения.</div><div class="room-layout"><aside class="panel sidebar"><div class="roster-title"><h2>Компания</h2><span class="count-pill">${room.players.length} / ${room.settings.capacity ?? '∞'}</span></div><div class="roster">${roster()}</div><p class="sidebar-note">Общайтесь вживую или в своём видеозвонке. Секретные слова и мины каждый видит на своём экране.</p><button class="text-button" id="leave-button">Выйти из комнаты ↗</button></aside><div class="room-main">${room.phase==='lobby'?lobby():room.phase==='finished'?finished():room.phase==='paused'?paused():game()}</div></div>`;
  $('#invite-button').onclick = copyInvite;
  $('#leave-button').onclick = () => confirmAction('Выйти из комнаты?', room.phase==='lobby'?'Вы сможете зайти снова по ссылке.':'Очки и очередь остальных игроков сохранятся. Если нужно, текущий ход начнётся заново или игра подождёт новых участников.', 'Выйти', () => mutate('leave'));
  document.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => confirmAction('Удалить игрока?', `${playerName(b.dataset.kick)} выйдет из комнаты.${room.phase!=='lobby'?' Очки и очередь ходов остальных игроков сохранятся.':''}`, 'Удалить', () => mutate('kick',{playerId:b.dataset.kick})));
  document.querySelectorAll('[data-action]').forEach(b => b.onclick = () => mutate(b.dataset.action));
  $('#lobby-button')?.addEventListener('click',()=>confirmAction('Вернуться в лобби?', 'Текущая партия завершится. Вы сможете изменить настройки и начать заново.', 'В лобби',()=>mutate('lobby')));
  $('#skip-button')?.addEventListener('click',()=>confirmAction('Пропустить ход?', 'За этот ход никто не получит очков.', 'Пропустить',()=>mutate('skip')));
  $('#claim-button')?.addEventListener('click',()=>confirmAction('Мина прозвучала?', `Сообщить, что прозвучало слово «${room.round.myMine}»? Ведущий проверит и подтвердит подрыв.`, 'Сообщить о мине',()=>mutate('claim')));
  $('#accept-claim')?.addEventListener('click',()=>mutate('resolve',{accept:true}));
  $('#reject-claim')?.addEventListener('click',()=>mutate('resolve',{accept:false}));
  $('#mine-form')?.addEventListener('submit', e => { e.preventDefault(); mutate('mine',{word:$('#mine-word').value}); });
  $('#guess-form')?.addEventListener('submit', e => { e.preventDefault(); mutate('guess',{word:$('#guess-word').value}).then(success => { if(success) { drafts.delete('guess-word'); if($('#guess-word')) $('#guess-word').value=''; } }); });
  $('#settings-form')?.addEventListener('submit', e => { e.preventDefault(); const d=Object.fromEntries(new FormData(e.currentTarget)); d.useDefaultWords=$('#default-words').checked; mutate('settings',d).then(success=>{if(success){drafts.clear();toast('Настройки сохранены. Ведущий может начинать игру.');}}); });
  for (const [id,value] of drafts) { const input=document.getElementById(id); if (input) { if(input.type==='checkbox') input.checked=value; else input.value=value; } }
  document.querySelectorAll('.room-main input,.room-main textarea,.room-main select').forEach(input => input.addEventListener('input',()=>drafts.set(input.id,input.type==='checkbox'?input.checked:input.value)));
  if(oldDetails && $('#advanced')) $('#advanced').open=true;
  if(focused && document.getElementById(focused)) { const el=document.getElementById(focused); el.focus({preventScroll:true}); if(selection!=null && el.setSelectionRange) el.setSelectionRange(selection,selection); }
  updateTimer();
}
function lobby() {
  const s=room.settings;
  const config = isHost() ? `<form id="settings-form" class="panel"><h2>Под вашу компанию</h2><p class="subtext">Задай темп игры. Остальное — дело ассоциаций.</p><div class="settings-grid"><div class="field"><label for="set-capacity">Мест в комнате</label><input id="set-capacity" name="capacity" type="number" min="${Math.max(3,room.players.length)}" max="1000000" placeholder="Без ограничений" value="${s.capacity??''}"></div><div class="field"><label>На объяснение</label><div class="fixed-setting">Без таймера</div></div><div class="field"><label for="set-cycles">Кругов</label><input id="set-cycles" name="cycles" type="number" min="1" max="20" required value="${s.cycles}"></div></div><details class="advanced" id="advanced"><summary>Минирование и свои слова</summary><div class="field"><label>На установку мин</label><div class="fixed-setting">60 секунд</div></div><label class="check-label"><input id="default-words" name="useDefaultWords" type="checkbox" ${s.useDefaultWords?'checked':''}> Использовать встроенный словарь (200+ слов)</label><label for="set-custom">Свои слова</label><textarea id="set-custom" name="customWords" placeholder="По одному слову на строку. Или через запятую." maxlength="61000">${esc(s.customWords)}</textarea><span class="field-help">До 1000 слов. Если играете со своими словами, организатор уже знает словарь.</span></details><div class="settings-save"><span class="settings-note">Каждый получит роли объясняющего и угадывающего. Очередь учитывает новых игроков.</span><button class="secondary" type="submit">Сохранить</button></div></form>` : `<div class="panel"><span class="eyebrow">ВСЁ ГОТОВО ДЛЯ ХОРОШЕГО ВЕЧЕРА</span><h2>Ждём старта</h2><p class="subtext">Ведущий — ${esc(playerName(room.hostId))}. Готовность необязательна — ведущий может начать, когда в комнате хотя бы трое.</p><div class="stats-strip"><div class="stat"><strong>Без таймера</strong><span>На объяснение</span></div><div class="stat"><strong>60 сек</strong><span>На мины</span></div><div class="stat"><strong>${s.cycles}</strong><span>Кругов</span></div></div></div>`;
  return `${config}<div class="panel lobby-bottom"><div><h3>В комнате ${room.players.length} игроков</h3><p>${room.players.length<3?'Нужны хотя бы три игрока.':'Ведущий может начинать. Готовность необязательна.'}</p></div><div class="buttons"><button class="${me().ready?'secondary':'primary'}" data-action="ready">${me().ready?'✓ Я готов':'Я готов'}</button>${isHost()?`<button class="primary" data-action="start" ${room.players.length<3?'disabled':''}>Начать игру →</button>`:''}</div></div>`;
}
function paused() {
  return `<section class="panel"><span class="eyebrow">ИГРА НА ПАУЗЕ</span><h2>Нужно хотя бы три игрока</h2><p class="subtext">Пригласи ещё ${Math.max(0,3-room.players.length)}. Очки и сыгранные роли сохраняются. Когда соберётся трое, игра продолжится автоматически.</p><div class="note">Сначала играют те, кто реже объяснял и угадывал. Если кто-то ушёл, могут понадобиться дополнительные ходы, чтобы каждый получил обе роли.</div></section>${isHost()?'<div class="admin-controls"><button class="text-button" id="lobby-button">Вернуться в лобби ↗</button></div>':''}`;
}
function secretCard() {
  const r=room.round;
  return `<div class="secret-card"><span class="mini-label">${r.word?'СЕКРЕТНОЕ СЛОВО':'СЛОВО ЗНАЕТ ТВОЙ НАПАРНИК'}</span><div class="secret-word ${r.word?'':'hidden-word'}">${r.word?esc(r.word):'••••••'}</div><p>${r.role==='guesser'&&!r.word?`Слушай внимательно. ${esc(playerName(r.explainerId))} поможет с ответом.`:'Не показывай этот экран угадывающему.'}</p></div>`;
}
function sharedMines() {
  const r=room.round;
  const miners=room.players.filter(p=>p.id!==r.explainerId && p.id!==r.guesserId);
  return `<section class="advanced" aria-label="Мины компании"><span class="mini-label">МИНЫ КОМПАНИИ</span><p class="subtext" style="margin-top:10px">Видны только минёрам. Слова появляются после установки.</p><div class="mines-list" aria-live="polite">${miners.map(p=>`<span class="mine-chip">${r.mines?.[p.id]?esc(r.mines[p.id]):`<span class="muted">${room.phase==='mining'?'Ещё выбирает…':'Без мины в этом ходу'}</span>`}<small>${esc(p.name)}${p.id===room.me?' (ты)':''}</small></span>`).join('')}</div></section>`;
}
function game() {
  const r=room.round;
  let content='';
  if(room.phase==='mining') {
    content=`<h2>${r.role==='miner'?'Что станет ловушкой?':'Минёры готовят сюрпризы'}</h2><p class="subtext">${r.role==='miner'?'Подумай, какое слово или фраза может прозвучать в объяснении или ответе.':'Объяснение начнётся, когда все установят мины или закончится время.'}</p>${secretCard()}`;
    if(r.role==='miner') content+=r.myMine?`<div class="status-block">Твоя мина: <strong>${esc(r.myMine)}</strong><br><span class="muted">Установлена. Осталось дождаться остальных.</span></div>`:`<form id="mine-form" class="mine-form"><input id="mine-word" placeholder="Слово или фраза" minlength="1" maxlength="20" autocomplete="off" aria-label="Слово или фраза-мина" aria-describedby="mine-help" required><button class="primary" type="submit">Установить мину ✳</button></form><p class="field-help" id="mine-help">До 20 символов, включая пробелы.</p>`;
    content+=`<div class="mine-progress">Установлено мин: ${r.mineCount} из ${room.players.length-2}<div class="progress-track"><div class="progress-fill" style="width:${100*r.mineCount/(room.players.length-2)}%"></div></div></div>`;
  } else if(room.phase==='explaining') {
    content=`<h2>${r.role==='explainer'?'Объясняй. Осторожно со словами.':r.role==='guesser'?'Лови мысль. Найди ответ.':'Слушай. Твоя мина может сработать.'}</h2><p class="subtext">${esc(playerName(r.explainerId))} объясняет · ${esc(playerName(r.guesserId))} угадывает</p>${secretCard()}`;
    if(r.role==='guesser') content+=`<form id="guess-form" class="mine-form"><input id="guess-word" maxlength="60" placeholder="Твоя версия" aria-label="Ответ" autocomplete="off" required><button class="primary" type="submit">Это оно? →</button></form>`;
    if(r.lastGuess) content+=`<p class="subtext" style="margin-top:14px">Последняя версия: «${esc(r.lastGuess)}» — пока мимо.</p>`;
    if(r.role==='miner') content+=r.myMine?`<div class="status-block">Твоя мина: <strong>${esc(r.myMine)}</strong><br><span class="muted">Если слово прозвучало вслух, сообщи об этом.</span></div><div class="game-controls"><button id="claim-button" class="danger">✳ Моя мина сработала</button></div>`:'<p class="note">В этом ходу у тебя нет мины. Следи за игрой — со следующего хода сможешь установить свою.</p>';
    if(r.role==='explainer'||isHost()) content+='<div class="game-controls"><button class="primary" data-action="guessed">✓ Слово угадали вслух</button></div>';
  } else if(room.phase==='claim') {
    content=`<div class="result-heading"><div class="result-symbol" style="color:var(--red)">✳</div><h2>Кажется, кто-то подорвался</h2><p>${esc(playerName(r.claim.playerId))} сообщает: прозвучало слово</p><div class="secret-word">${esc(r.claim.word)}</div><p>Ведущий проверяет подрыв.</p></div>${isHost()?'<div class="game-controls"><button id="accept-claim" class="danger">Подтвердить подрыв</button><button id="reject-claim" class="secondary">Не было — продолжаем</button></div>':'<div class="note">Ждём решения ведущего.</div>'}`;
  } else if(room.phase==='result') {
    const titles={guessed:'Есть контакт!',exploded:'Мина сработала!',timeout:'Время вышло',skipped:'Ход пропущен'};
    const result=r.result;
    content=`<div class="result-heading"><div class="result-symbol">${result.outcome==='guessed'?'✧':result.outcome==='exploded'?'✳':'◷'}</div><h2>${titles[result.outcome]}</h2><p>Секретное слово</p><div class="secret-word">${esc(r.word)}</div><p>${result.winnerIds.length?result.winnerIds.map(id=>esc(playerName(id))).join(', ')+' — по +1 очку':'В этом ходу без очков.'}</p></div><div class="advanced"><span class="mini-label">МИНЫ ЭТОГО ХОДА</span><div class="mines-list">${Object.entries(r.mines).map(([id,word])=>`<span class="mine-chip ${result.winnerIds.includes(id)&&result.outcome==='exploded'?'hit':''}">${esc(word)}<small>${esc(playerName(id))}</small></span>`).join('')||'<span class="muted small">В этом ходу мин не было.</span>'}</div></div><div class="game-controls">${isHost()?`<button class="primary" data-action="next">${room.turn+1>=room.totalTurns?'Итоги игры':'Следующий ход'} →</button>`:'<p class="subtext">Ведущий скоро продолжит игру.</p>'}</div>`;
  }
  if(r.role==='miner' && ['mining','explaining','claim'].includes(room.phase)) content+=sharedMines();
  return `<section class="panel"><div class="game-head"><span class="role-pill">Ты — ${roleNames[r.role].toLowerCase()}</span><span id="timer" class="timer" aria-label="Оставшееся время"></span></div>${content}</section>${isHost()?`<div class="admin-controls">${['mining','explaining','claim'].includes(room.phase)?'<button class="text-button" id="skip-button">Пропустить ход</button>':'<span></span>'}<button class="text-button" id="lobby-button">Вернуться в лобби ↗</button></div>`:''}`;
}
function finished() {
  const players=[...room.players].sort((a,b)=>b.score-a.score);
  const leaders=players.filter(p=>p.score===players[0].score);
  return `<section class="panel"><div class="result-heading"><div class="result-symbol">✷</div><span class="eyebrow">ЛОВУШКИ ПОЗАДИ</span><h2>${leaders.length===1?`${esc(leaders[0].name)} — победитель!`:'Победа на двоих? Или больше!'}</h2><p>${leaders.length>1?leaders.map(p=>esc(p.name)).join(', ')+' делят первое место.':'Слова закончились. Хорошая компания осталась.'}</p></div><div class="ranking">${players.map((p,i)=>`<div class="rank-row"><span class="rank-number">${i>0&&p.score===players[i-1].score?'=':i+1}</span><span class="rank-name">${esc(p.name)}${p.id===room.me?' <span class="muted small">(ты)</span>':''}</span><span class="score">${p.score}</span></div>`).join('')}</div>${isHost()?'<button class="primary full" data-action="lobby">Сыграем ещё? →</button>':'<p class="subtext">Ведущий может собрать новую игру в лобби.</p>'}</section>`;
}
function updateTimer() {
  const element=$('#timer'); if(!element||!room?.round) return;
  const deadline=room.round.deadline;
  element.classList.toggle('untimed', !deadline);
  element.setAttribute('aria-label', deadline ? 'Оставшееся время на установку мин' : '');
  if(!deadline) { element.classList.remove('low'); element.textContent=room.phase==='explaining'?'Без таймера':room.phase==='claim'?'Проверка':'—'; return; }
  const seconds=Math.max(0,Math.ceil((deadline-Date.now()-offset)/1000));
  element.textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  element.classList.toggle('low',seconds<=10);
}
async function mutate(action,data={}) {
  if(busy) return false; busy=true;
  if(room?.round && ['mine','guess','guessed','claim','resolve','skip','next'].includes(action)) data={...data,roundId:room.round.id};
  const buttons=[...document.querySelectorAll('.room-main button,.kick,#leave-button')]; buttons.forEach(b=>b.disabled=true);
  try {
    const result=await request(`/api/rooms/${session.code}/action`,{action,data});
    if(result.left) { clearSession(); room=null; signature=''; drafts.clear(); history.replaceState(null,'','/'); entry(); }
    else accept(result.room);
    return true;
  } catch(e) { toast(e.message); if(e.status===401||e.status===404) lostRoom(e.message); return false; }
  finally { busy=false; if(room) {signature='';renderRoom();} }
}
function confirmAction(title,message,label,callback) {
  const dialog=document.createElement('dialog'); dialog.className='dialog';
  dialog.innerHTML=`<h2>${esc(title)}</h2><p class="confirmation-text">${esc(message)}</p><div class="confirm-actions"><button class="secondary" id="cancel-confirm">Отмена</button><button class="primary" id="accept-confirm">${esc(label)}</button></div>`;
  document.body.append(dialog); dialog.showModal();
  dialog.querySelector('#cancel-confirm').onclick=()=>dialog.close();
  dialog.querySelector('#accept-confirm').onclick=()=>{dialog.close();callback();};
  dialog.onclose=()=>dialog.remove();
}
async function copyInvite() {
  const link=`${location.origin}/?room=${room.code}`;
  try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована. Пароль для друзей — ACM.'); }
  catch { const d=document.createElement('dialog');d.className='dialog';d.innerHTML=`<h2>Пригласи друзей</h2><p class="confirmation-text">Скопируй ссылку и передай пароль ACM.</p><input readonly aria-label="Ссылка на комнату" value="${esc(link)}"><button class="secondary full" style="margin-top:18px">Готово</button>`;document.body.append(d);d.showModal();d.querySelector('input').select();d.querySelector('button').onclick=()=>d.close();d.onclose=()=>d.remove(); }
}
function clearSession(){session=null;try{sessionStorage.removeItem('acm-session');}catch{}}
function lostRoom(message){clearSession();room=null;signature='';entry();toast(message);}
async function poll() {
  if(!session||busy||polling||document.hidden) return; polling=true;
  try { const result=await request(`/api/rooms/${session.code}`); accept(result.room); }
  catch(e) { if(e.status===401||e.status===404) lostRoom(e.message); else {connected=false;$('#connection')?.removeAttribute('hidden');} }
  finally{polling=false;}
}
setInterval(poll,1200);setInterval(updateTimer,250);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
if(session && (!new URLSearchParams(location.search).get('room') || new URLSearchParams(location.search).get('room').toUpperCase()===session.code)) {
  try { const result=await request(`/api/rooms/${session.code}`); history.replaceState(null,'',`/?room=${session.code}`);accept(result.room); }
  catch(e){if(e.status===401||e.status===404)clearSession();entry();toast(e.message);}
} else {clearSession();entry();}
