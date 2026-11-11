import { t, getLanguage, setLanguage, languages, translateError } from './i18n.js';
import { renderScoreboard } from './scoreboard.js';

const $ = selector => document.querySelector(selector);
const app = $('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tr = (key, values) => esc(t(key, values));
const icons = {
  talk: '<path d="M5 5h22v16H15l-7 6v-6H5z"/><path d="M11 11h10m-10 5h6"/>',
  mine: '<circle cx="16" cy="19" r="10"/><path d="M20 9c0-7 8-1 8-7M27 2l2-2M12 15l-2 3"/>',
  guess: '<path d="M10 20c-8-10 12-19 15-7 1 4-3 5-5 7l-1 4h-7zM12 28h7m-14-15H1m28 0h3M7 4 4 1m22 3 3-3"/>'
};
const icon = name => `<svg class="role-icon" viewBox="0 0 33 33" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
let room = null, session = null, tab = new URLSearchParams(location.search).has('room') ? 'join' : 'create';
let busy = false, polling = false, connected = true, offset = 0, signature = '', toastTimeout;
const drafts = new Map(), entryDrafts = new Map();
function readStoredValue(storage, key, legacyKey) {
  const current = storage.getItem(key);
  if (current !== null) return current;
  const previous = storage.getItem(legacyKey);
  if (previous !== null) { storage.setItem(key, previous); storage.removeItem(legacyKey); }
  return previous;
}
try { session = JSON.parse(readStoredValue(sessionStorage, 'word-mine-session', 'acm-session')); } catch {}

function localizeShell() {
  document.documentElement.lang = getLanguage();
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('.brand').setAttribute('aria-label', t('home'));
  $('#language-switch').setAttribute('aria-label', t('language'));
  document.querySelectorAll('[data-language]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.language === getLanguage()));
  });
  $('#close-rules').setAttribute('aria-label', t('close'));
  const theme = $('#theme-toggle');
  theme.setAttribute('aria-label', t('darkTheme'));
  theme.dataset.lightTitle = t('lightTheme');
  theme.dataset.darkTitle = t('enableDark');
  window.dispatchEvent(new Event('wordmine:theme-labels'));
  $('#rule-list').innerHTML = ['Roles','Mines','Explain','Claim','Score'].map(key => `<li><strong>${tr('rules'+key)}</strong><p>${tr('rules'+key+'Text')}</p></li>`).join('');
}
function captureEntry() {
  $('#entry-form')?.querySelectorAll('input').forEach(input => entryDrafts.set(input.id, input.value));
}
document.querySelectorAll('[data-language]').forEach(button => {
  button.onclick = () => {
    if (button.dataset.language === getLanguage()) return;
    captureEntry();
    setLanguage(button.dataset.language);
    localizeShell();
    if (room) renderRoom(); else entry();
  };
});
localizeShell();
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
$('#rules-button').onclick = () => $('#rules').showModal();
$('#close-rules').onclick = () => $('#rules').close();
$('#rules').addEventListener('click', e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientY < r.top || e.clientX > r.right || e.clientY > r.bottom) e.currentTarget.close(); } });

function entry() {
  const invite = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  const legacyInvite = /[A-Z]/.test(invite);
  app.innerHTML = `<section class="hero"><div class="hero-copy"><h1>${tr('heroTitle')}<br><em>${tr('heroAccent')}</em></h1><p class="hero-description">${tr('heroDescription')}</p></div>
  <div class="entry-card"><div class="tabs" role="tablist" aria-label="${tr('entryTabs')}"><button id="create-tab" class="tab ${tab==='create'?'active':''}" role="tab" aria-selected="${tab==='create'}" aria-controls="entry-form" tabindex="${tab==='create'?0:-1}" data-tab="create">${tr('create')}</button><button id="join-tab" class="tab ${tab==='join'?'active':''}" role="tab" aria-selected="${tab==='join'}" aria-controls="entry-form" tabindex="${tab==='join'?0:-1}" data-tab="join">${tr('join')}</button></div>
  <form id="entry-form" class="entry-form" role="tabpanel" aria-labelledby="${tab}-tab"><div class="field"><label for="name">${tr('name')}</label><input name="name" id="name" placeholder="${tr('namePlaceholder')}" maxlength="24" autocomplete="nickname" required></div>
  ${tab==='create'?`<div class="field"><label for="capacity">${tr('capacity')}</label><input id="capacity" name="capacity" type="number" min="3" max="1000000" step="1" placeholder="${tr('unlimited')}"><span class="field-help">${tr('capacityHelp')}</span></div>`:`<div class="field"><label for="code">${tr('code')}</label><input id="code" name="code" placeholder="${tr('codePlaceholder')}" value="${esc(invite)}" minlength="4" maxlength="6" pattern="([0-9]{6}|[0-9]{4}|[A-Za-z2-9]{6})" inputmode="${legacyInvite?'text':'numeric'}" autocomplete="off" spellcheck="false" required></div>`}
  <p class="error" id="entry-error" role="alert"></p><button class="primary full" type="submit" ${busy?'disabled':''}>${tr(tab==='create'?'createAction':'enter')}<span class="button-arrow">→</span></button>${tab==='join'?`<p class="form-note">${tr('recovery')}</p>`:''}</form></div></section>
  <section class="how-section"><div class="roles-grid">${[['talk','explain','explainHelp'],['mine','mine','mineHelp'],['guess','guess','guessHelp']].map(([symbol,title,help],i)=>`<article class="role-card"><span class="step">0${i+1}</span>${icon(symbol)}<h3>${tr(title)}</h3><p>${tr(help)}</p></article>`).join('')}</div></section>`;
  try { $('#name').value = readStoredValue(localStorage, 'word-mine-name', 'acm-name') || ''; } catch {}
  for (const [id,value] of entryDrafts) { if(document.getElementById(id)) document.getElementById(id).value=value; }
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.onclick = () => { if(tab===button.dataset.tab) return; captureEntry(); tab=button.dataset.tab; entry(); $(`#${tab}-tab`).focus(); };
    button.onkeydown = e => {
      if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); captureEntry(); tab=e.key==='Home'?'create':e.key==='End'?'join':tab==='create'?'join':'create'; entry(); $(`#${tab}-tab`).focus(); }
    };
  });
  $('#entry-form').onsubmit = async e => {
    e.preventDefault(); if(busy) return;
    captureEntry();
    const values=Object.fromEntries(new FormData(e.currentTarget));
    const button=e.currentTarget.querySelector('[type=submit]'); button.disabled=true; busy=true; $('#entry-error').textContent='';
    try {
      const result=await request(tab==='create'?'/api/rooms':`/api/rooms/${values.code.trim().toUpperCase()}/join`,{name:values.name,settings:{capacity:values.capacity,wordLanguage:getLanguage()}});
      session={code:result.room.code,token:result.token};
      try { sessionStorage.setItem('word-mine-session',JSON.stringify(session)); localStorage.setItem('word-mine-name',values.name); } catch {}
      history.replaceState(null,'',`/?room=${session.code}`); accept(result.room);
      if(result.rejoined) toast(t('welcomeBack'));
    } catch(e) { $('#entry-error').textContent=e.message; $('#entry-form [type=submit]').disabled=false; }
    finally { busy=false; if(room)renderRoom(); }
  };
}
async function request(path,data) {
  let response;
  try { response=await fetch(path,{method:data?'POST':'GET',headers:{...(data&&{'Content-Type':'application/json'}),...(session&&{'Authorization':`Bearer ${session.token}`})},...(data&&{body:JSON.stringify(data)}),signal:AbortSignal.timeout(12000)}); } catch { throw new Error(t('serverUnavailable')); }
  let result;
  try { result=await response.json(); } catch { throw new Error(t('serverUnavailable')); }
  if(!response.ok) { const error=new Error(translateError(result.error)); error.status=response.status; throw error; }
  return result;
}
function accept(next) {
  if(room && next.serverNow<room.serverNow) return;
  if(room && (room.phase!==next.phase || room.turn!==next.turn || room.round?.id!==next.round?.id)) drafts.clear();
  room=next; offset=next.serverNow-Date.now(); connected=true;
  const nextSignature=JSON.stringify({...next,serverNow:0});
  if(signature!==nextSignature) { signature=nextSignature; renderRoom(); }
  $('#connection')?.setAttribute('hidden',''); updateTimer();
}
const isHost=()=>room.me===room.hostId;
const playerName=id=>room.players.find(p=>p.id===id)?.name || room.round?.names?.[id] || t('player');
const me=()=>room.players.find(p=>p.id===room.me);
function roster() {
  return room.players.map(p=>{
    const status=room.phase==='lobby'?(p.ready?'readyStatus':'inRoom'):room.phase==='paused'?'waitingPlayers':room.phase==='finished'?'gameOver':p.id===room.round?.explainerId?'explaining':p.id===room.round?.guesserId?'guessing':'miner';
    return `<div class="player"><div class="avatar">${esc(p.name.slice(0,2).toUpperCase())}</div><div class="player-info"><div class="player-name">${esc(p.name)}${p.id===room.me?` <span class="muted small">(${tr('you')})</span>`:''}</div><div class="player-status">${tr(status)}${p.id===room.hostId?` · ${tr('host')}`:''}</div></div>${room.phase!=='lobby'?`<span class="score">${p.score}</span>`:''}${isHost()&&p.id!==room.me?`<button class="kick" data-kick="${p.id}" aria-label="${tr('removePlayer',{name:p.name})}">✕</button>`:''}</div>`;
  }).join('');
}
function renderRoom() {
  const oldDetails=$('#advanced')?.open;
  const focused=document.activeElement?.id;
  const selection=document.activeElement && ['text','search'].includes(document.activeElement.type)?document.activeElement.selectionStart:null;
  app.innerHTML=`<div class="room-top"><h1>${room.phase==='lobby'?tr('lobby'):room.phase==='finished'?tr('gameOver'):room.phase==='paused'?tr('waitingPlayers'):tr('turn',{current:Math.min(room.turn+1,room.totalTurns),total:room.totalTurns})}</h1><div class="room-actions"><button class="secondary" id="invite-button">${tr('invite')} ↗</button><span class="room-code" aria-label="${tr('code')}">${esc(room.code)}</span></div></div>
  <div class="connection" id="connection" ${connected?'hidden':''}>${tr('reconnecting')}</div><div class="room-layout"><aside class="panel sidebar"><div class="roster-title"><h2>${tr('players')}</h2><span class="count-pill">${room.players.length} / ${room.settings.capacity??'∞'}</span></div><div class="roster">${roster()}</div><button class="text-button" id="leave-button">${tr('leave')} ↗</button></aside><div class="room-main">${room.phase==='lobby'?lobby():room.phase==='finished'?finished():room.phase==='paused'?paused():game()}</div></div>`;
  $('#invite-button').onclick=copyInvite;
  $('#leave-button').onclick=()=>confirmAction(t('leaveTitle'),t(room.phase==='lobby'?'leaveLobby':'leaveGame'),t('leave'),()=>mutate('leave'));
  document.querySelectorAll('[data-kick]').forEach(b=>b.onclick=()=>confirmAction(t('removeTitle'),t('removeMessage',{name:playerName(b.dataset.kick)}),t('remove'),()=>mutate('kick',{playerId:b.dataset.kick})));
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>mutate(b.dataset.action));
  $('#lobby-button')?.addEventListener('click',()=>confirmAction(t('lobbyTitle'),t('lobbyMessage'),t('toLobby'),()=>mutate('lobby')));
  $('#skip-button')?.addEventListener('click',()=>confirmAction(t('skipTitle'),t('skipMessage'),t('skip'),()=>mutate('skip')));
  $('#claim-button')?.addEventListener('click',()=>confirmAction(t('claimTitle'),t('claimMessage',{word:room.round.myMine}),t('report'),()=>mutate('claim')));
  $('#accept-claim')?.addEventListener('click',()=>mutate('resolve',{accept:true}));
  $('#reject-claim')?.addEventListener('click',()=>mutate('resolve',{accept:false}));
  $('#mine-form')?.addEventListener('submit',e=>{e.preventDefault();mutate('mine',{word:$('#mine-word').value}).then(success=>{if(success)drafts.delete('mine-word');});});
  $('#guess-form')?.addEventListener('submit',e=>{e.preventDefault();mutate('guess',{word:$('#guess-word').value}).then(success=>{if(success){drafts.delete('guess-word');if($('#guess-word'))$('#guess-word').value='';}});});
  $('#settings-form')?.addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));d.useDefaultWords=$('#default-words').checked;mutate('settings',d).then(success=>{if(success){drafts.clear();renderRoom();toast(t('saved'));}});});
  for(const [id,value] of drafts) { const input=document.getElementById(id);if(input){if(input.type==='checkbox')input.checked=value;else input.value=value;} }
  document.querySelectorAll('.room-main input,.room-main textarea,.room-main select').forEach(input=>input.addEventListener('input',()=>drafts.set(input.id,input.type==='checkbox'?input.checked:input.value)));
  const refreshWordCount=()=>{ const counts=room.settings.wordCounts||{ru:500}; $('#default-words-label').textContent=t('defaultWords',{count:counts[$('#set-word-language').value]||0}); };
  if($('#set-word-language')) { refreshWordCount(); $('#set-word-language').addEventListener('change',refreshWordCount); }
  if(oldDetails&&$('#advanced'))$('#advanced').open=true;
  if(focused&&document.getElementById(focused)){const el=document.getElementById(focused);el.focus({preventScroll:true});if(selection!=null&&el.setSelectionRange)el.setSelectionRange(selection,selection);}
  if(busy) document.querySelectorAll('.room-main button,.kick,#leave-button').forEach(b=>b.disabled=true);
  updateTimer();
}
function lobby() {
  const s=room.settings;
  const config=isHost()?`<form id="settings-form" class="panel"><h2>${tr('settings')}</h2><div class="settings-grid"><div class="field"><label for="set-capacity">${tr('capacity')}</label><input id="set-capacity" name="capacity" type="number" min="${Math.max(3,room.players.length)}" max="1000000" placeholder="${tr('unlimited')}" value="${s.capacity??''}"></div><div class="field"><label for="set-cycles">${tr('cycles')}</label><input id="set-cycles" name="cycles" type="number" min="1" max="20" required value="${s.cycles}"></div><div class="field"><label for="set-word-language">${tr('wordLanguage')}</label><select id="set-word-language" name="wordLanguage">${Object.entries(languages).map(([code,name])=>`<option value="${code}" ${code===(s.wordLanguage||'ru')?'selected':''}>${esc(name)}</option>`).join('')}</select></div></div><details class="advanced" id="advanced"><summary>${tr('miningSettings')}</summary><div class="field"><label>${tr('miningTime')}</label><div class="fixed-setting">${tr('sixtySeconds')}</div></div><label class="check-label"><input id="default-words" name="useDefaultWords" type="checkbox" ${s.useDefaultWords?'checked':''}><span id="default-words-label">${tr('defaultWords',{count:s.wordCounts?.[s.wordLanguage||'ru']||500})}</span></label><label for="set-custom">${tr('customWords')}</label><textarea id="set-custom" name="customWords" placeholder="${tr('customPlaceholder')}" maxlength="61000">${esc(s.customWords)}</textarea><span class="field-help">${tr('customHelp')}</span></details><div class="settings-save"><span class="settings-note">${tr('duration')}: ${tr('untimed')}</span><button class="secondary" type="submit">${tr('save')}</button></div></form>`:`<div class="panel"><h2>${tr('waitingStart')}</h2><p class="subtext">${tr('waitingHost',{name:playerName(room.hostId)})}</p><div class="stats-strip"><div class="stat"><strong>${s.cycles}</strong><span>${tr('cycles')}</span></div><div class="stat"><strong>${esc(languages[s.wordLanguage||'ru'])}</strong><span>${tr('wordLanguage')}</span></div></div></div>`;
  return `${config}<div class="panel lobby-bottom"><div><h3>${tr('playerCount',{count:room.players.length})}</h3><p>${tr(room.players.length<3?'needThree':'canStart')}</p></div><div class="buttons"><button class="${me().ready?'secondary':'primary'}" data-action="ready">${me().ready?'✓ ':''}${tr('ready')}</button>${isHost()?`<button class="primary" data-action="start" ${room.players.length<3?'disabled':''}>${tr('start')} →</button>`:''}</div></div>`;
}
function paused() {
  return `<section class="panel"><h2>${tr('pause')}</h2><p class="subtext">${tr('pauseHelp',{count:Math.max(0,3-room.players.length)})}</p></section>${isHost()?`<div class="admin-controls"><button class="text-button" id="lobby-button">${tr('toLobby')} ↗</button></div>`:''}`;
}
function secretCard() {
  const r=room.round;
  return `<div class="secret-card"><span class="mini-label">${tr(r.word?'secret':'partnerKnows')}</span><div class="secret-word ${r.word?'':'hidden-word'}">${r.word?esc(r.word):'••••••'}</div><p>${r.role==='guesser'&&!r.word?tr('listenTo',{name:playerName(r.explainerId)}):tr('keepSecret')}</p>${r.canRedraw?`<button class="secondary" data-action="redraw">↻ ${tr('redraw')}</button><p class="field-help">${tr('redrawHelp')}</p>`:''}</div>`;
}
function sharedMines() {
  const r=room.round;
  const miners=room.players.filter(p=>p.id!==r.explainerId&&p.id!==r.guesserId);
  return `<section class="advanced" aria-label="${tr('sharedMines')}"><span class="mini-label">${tr('sharedMines')}</span><p class="subtext">${tr('minersOnly')}</p><div class="mines-list" aria-live="polite">${miners.map(p=>`<span class="mine-chip">${r.mines?.[p.id]?esc(r.mines[p.id]):`<span class="muted">${tr(room.phase==='mining'?'choosingMine':'noMine')}</span>`}<small>${esc(p.name)}${p.id===room.me?` (${tr('you')})`:''}</small></span>`).join('')}</div></section>`;
}
function scoreboard() {
  return renderScoreboard(room.players, room.me, {title:t('scoreboard'),place:t('place'),player:t('player'),score:t('score'),you:t('you')});
}
function game() {
  const r=room.round;
  let content='';
  if(room.phase==='mining') {
    content=`<h2>${tr(r.role==='miner'?'miningTitle':'miningWaiting')}</h2><p class="subtext">${tr(r.role==='miner'?'miningHint':'miningWaitHint')}</p>${secretCard()}`;
    if(r.role==='miner')content+=`${r.myMine?`<div class="status-block">${tr('yourMine')}: <strong>${esc(r.myMine)}</strong><br><span class="muted">${tr('replaceHint')}</span></div>`:''}<form id="mine-form" class="mine-form"><input id="mine-word" value="${esc(r.myMine||'')}" placeholder="${tr('minePlaceholder')}" minlength="1" maxlength="20" autocomplete="off" aria-label="${tr('mineInput')}" aria-describedby="mine-help" required><button class="primary" type="submit">${tr(r.myMine?'replaceMine':'placeMine')}</button></form><p class="field-help" id="mine-help">${tr('mineLimit')}</p>`;
    content+=`<div class="mine-progress">${tr('mineCount',{placed:r.mineCount,total:room.players.length-2})}<div class="progress-track"><div class="progress-fill" style="width:${100*r.mineCount/(room.players.length-2)}%"></div></div></div>`;
  } else if(room.phase==='explaining') {
    content=`<h2>${tr(r.role==='explainer'?'explainTitle':r.role==='guesser'?'guessTitle':'listenTitle')}</h2><p class="subtext">${tr('activePair',{explainer:playerName(r.explainerId),guesser:playerName(r.guesserId)})}</p>${secretCard()}`;
    if(r.role==='guesser')content+=`<form id="guess-form" class="mine-form"><input id="guess-word" maxlength="60" placeholder="${tr('guessPlaceholder')}" aria-label="${tr('answer')}" autocomplete="off" required><button class="primary" type="submit">${tr('submitGuess')} →</button></form>`;
    if(r.lastGuess)content+=`<p class="subtext">${tr('wrongGuess',{word:r.lastGuess})}</p>`;
    if(r.role==='miner')content+=r.myMine?`<div class="status-block">${tr('yourMine')}: <strong>${esc(r.myMine)}</strong><br><span class="muted">${tr('reportHint')}</span></div><div class="game-controls"><button id="claim-button" class="danger">✳ ${tr('claim')}</button></div>`:`<p class="note">${tr('noMineHint')}</p>`;
    if(r.role==='explainer'||isHost())content+=`<div class="game-controls"><button class="primary" data-action="guessed">✓ ${tr('guessedAloud')}</button></div>`;
  } else if(room.phase==='claim') {
    content=`<div class="result-heading"><h2>${tr('claimHeading')}</h2><p>${tr('claimBy',{name:playerName(r.claim.playerId)})}</p><div class="secret-word">${esc(r.claim.word)}</div><p>${tr('hostChecking')}</p></div>${isHost()?`<div class="game-controls"><button id="accept-claim" class="danger">${tr('acceptClaim')}</button><button id="reject-claim" class="secondary">${tr('rejectClaim')}</button></div>`:`<div class="note">${tr('waitDecision')}</div>`}`;
  } else if(room.phase==='result') {
    const titles={guessed:'resultGuessed',exploded:'resultExploded',timeout:'resultTimeout',skipped:'resultSkipped'};
    const result=r.result;
    content=`<div class="result-heading"><h2>${tr(titles[result.outcome])}</h2><p>${tr('secret')}</p><div class="secret-word">${esc(r.word)}</div><p>${result.winnerIds.length?tr('pointsAwarded',{names:result.winnerIds.map(playerName).join(', ')}):tr('noPoints')}</p></div>${scoreboard()}<div class="advanced"><span class="mini-label">${tr('roundMines')}</span><div class="mines-list">${Object.entries(r.mines).map(([id,word])=>`<span class="mine-chip ${result.winnerIds.includes(id)&&result.outcome==='exploded'?'hit':''}">${esc(word)}<small>${esc(playerName(id))}</small></span>`).join('')||`<span class="muted small">${tr('noRoundMines')}</span>`}</div></div><div class="game-controls">${isHost()?`<button class="primary" data-action="next">${tr(room.turn+1>=room.totalTurns?'gameResults':'next')} →</button>`:`<p class="subtext">${tr('waitNext')}</p>`}</div>`;
  }
  if(r.role==='miner'&&['mining','explaining','claim'].includes(room.phase))content+=sharedMines();
  return `<section class="panel">${room.phase!=='result'?`<div class="game-head"><span class="role-pill">${tr('role',{role:t(r.role)})}</span><span id="timer" class="timer" aria-label="${tr('timeLeft')}"></span></div>`:''}${content}</section>${isHost()?`<div class="admin-controls">${['mining','explaining','claim'].includes(room.phase)?`<button class="text-button" id="skip-button">${tr('skip')}</button>`:'<span></span>'}<button class="text-button" id="lobby-button">${tr('toLobby')} ↗</button></div>`:''}`;
}
function finished() {
  const highest=Math.max(...room.players.map(p=>p.score));
  const leaders=room.players.filter(p=>p.score===highest);
  return `<section class="panel"><div class="result-heading"><h2>${leaders.length===1?tr('winner',{name:leaders[0].name}):tr('tied')}</h2>${leaders.length>1?`<p>${tr('tiedNames',{names:leaders.map(p=>p.name).join(', ')})}</p>`:''}</div>${scoreboard()}${isHost()?`<button class="primary full" data-action="lobby">${tr('playAgain')} →</button>`:`<p class="subtext">${tr('waitNewGame')}</p>`}</section>`;
}
function updateTimer() {
  const element=$('#timer'); if(!element||!room?.round)return;
  const deadline=room.round.deadline;
  element.classList.toggle('untimed',!deadline);
  element.setAttribute('aria-label',deadline?t('timeLeft'):'');
  if(!deadline){element.classList.remove('low');element.textContent=room.phase==='explaining'?t('untimed'):room.phase==='claim'?t('checking'):'—';return;}
  const seconds=Math.max(0,Math.ceil((deadline-Date.now()-offset)/1000));
  element.textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  element.classList.toggle('low',seconds<=10);
}
async function mutate(action,data={}) {
  if(busy)return false;busy=true;
  if(room?.round&&['mine','redraw','guess','guessed','claim','resolve','skip','next'].includes(action))data={...data,roundId:room.round.id};
  document.querySelectorAll('.room-main button,.kick,#leave-button').forEach(b=>b.disabled=true);
  try {
    const result=await request(`/api/rooms/${session.code}/action`,{action,data});
    if(result.left){clearSession();room=null;signature='';drafts.clear();entryDrafts.clear();history.replaceState(null,'','/');entry();}
    else accept(result.room);
    return true;
  } catch(e){toast(e.message);if(e.status===401||e.status===404)lostRoom(e.message);return false;}
  finally{busy=false;if(room){signature='';renderRoom();}else if($('#entry-form [type=submit]'))$('#entry-form [type=submit]').disabled=false;}
}
function confirmAction(title,message,label,callback) {
  const dialog=document.createElement('dialog');dialog.className='dialog';
  dialog.innerHTML=`<h2>${esc(title)}</h2><p class="confirmation-text">${esc(message)}</p><div class="confirm-actions"><button class="secondary" id="cancel-confirm">${tr('cancel')}</button><button class="primary" id="accept-confirm">${esc(label)}</button></div>`;
  document.body.append(dialog);dialog.showModal();
  dialog.querySelector('#cancel-confirm').onclick=()=>dialog.close();
  dialog.querySelector('#accept-confirm').onclick=()=>{dialog.close();callback();};
  dialog.onclose=()=>dialog.remove();
}
async function copyInvite() {
  const link=`${location.origin}/?room=${room.code}`;
  try{await navigator.clipboard.writeText(link);toast(t('copied'));}
  catch{const d=document.createElement('dialog');d.className='dialog';d.innerHTML=`<h2>${tr('inviteTitle')}</h2><p class="confirmation-text">${tr('inviteHelp')}</p><input readonly aria-label="${tr('inviteLink')}" value="${esc(link)}"><button class="secondary full" style="margin-top:18px">${tr('done')}</button>`;document.body.append(d);d.showModal();d.querySelector('input').select();d.querySelector('button').onclick=()=>d.close();d.onclose=()=>d.remove();}
}
function clearSession(){session=null;try{sessionStorage.removeItem('word-mine-session');sessionStorage.removeItem('acm-session');}catch{}}
function lostRoom(message){clearSession();room=null;signature='';entry();toast(message);}
async function poll(){if(!session||busy||polling||document.hidden)return;polling=true;try{const result=await request(`/api/rooms/${session.code}`);accept(result.room);}catch(e){if(e.status===401||e.status===404)lostRoom(e.message);else{connected=false;$('#connection')?.removeAttribute('hidden');}}finally{polling=false;}}
setInterval(poll,1200);setInterval(updateTimer,250);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
if(session&&(!new URLSearchParams(location.search).get('room')||new URLSearchParams(location.search).get('room').toUpperCase()===session.code)){
  try{const result=await request(`/api/rooms/${session.code}`);history.replaceState(null,'',`/?room=${session.code}`);accept(result.room);}
  catch(e){if(e.status===401||e.status===404)clearSession();entry();toast(e.message);}
}else{clearSession();entry();}
