import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createRoom, joinRoom, newPlayer, settings, tick, view } from '../src/game.js';
import { WORDS } from '../src/words.js';
import { api } from '../src/api.js';

function setup(count=3, options={}) {
  const players=Array.from({length:count},(_,i)=>newPlayer(`Игрок ${i+1}`,`token-${i}`));
  const room=createRoom('1234',players[0],options,1000);
  players.slice(1).forEach(p=>joinRoom(room,p));
  return room;
}
function begin(room,now=1000) {
  room.players.forEach(p=>act(room,p.token,'ready',{},now));
  act(room,room.players[0].token,'start',{},now);
}
function mine(room,now=1001) {
  room.players.slice(2).forEach((p,i)=>act(room,p.token,'mine',{word:i===0?'ловушка':'опасность'},now));
  tick(room,room.round.deadline);
}
test('more than ten players, custom capacity and uncapped rooms',()=>{
  const r=setup(35);assert.equal(r.players.length,35);assert.equal(r.settings.capacity,null);
  const capped=setup(12,{capacity:12});
  assert.throws(()=>joinRoom(capped,newPlayer('Друг','other')),/заполнена/);
  act(capped,'token-0','settings',{capacity:30});
  joinRoom(capped,newPlayer('Друг','other'));assert.equal(capped.players.length,13);
  assert.throws(()=>act(capped,'token-0','settings',{capacity:10}),/больше/);
});
test('validates settings, custom dictionary and access to settings',()=>{
  for(const options of [{capacity:2},{capacity:3.5},{capacity:-1},{cycles:0},{useDefaultWords:false}])assert.throws(()=>settings(options));
  assert.equal(settings({duration:15,miningDuration:15}).duration,null);
  assert.equal(settings({duration:600,miningDuration:300}).miningDuration,60);
  assert.deepEqual(settings({customWords:'Кот, Кит\nКот; Дом'}).customWords,['Кот','Кит','Дом']);
  const r=setup();assert.throws(()=>act(r,'token-1','settings',{}),/ведущему/);
});
test('host can start with three players without readiness; others cannot',()=>{
  const small=setup(2);assert.throws(()=>act(small,'token-0','start'),/хотя бы 3/);
  const r=setup();
  assert.throws(()=>act(r,'token-1','start'),/ведущему/);
  assert.ok(r.players.every(p=>!p.ready));act(r,'token-0','start',{},1000);assert.equal(r.phase,'mining');
  joinRoom(r,newPlayer('Поздно','late'),1001);assert.equal(r.players.length,4);assert.equal(r.phase,'mining');
  assert.throws(()=>act(r,'token-1','mine',{word:'ловушка'},1001),/минёры/);
});
test('mines accept phrases and punctuation up to 20 characters, counting spaces',()=>{
  for(const word of ['я','два слова','два  слова','ну, может быть?','а'.repeat(9)+'  '+'б'.repeat(9)]) {
    const r=setup(3,{useDefaultWords:false,customWords:'Самолёт'});begin(r);
    act(r,'token-2','mine',{word},1001);
    assert.equal(r.round.mines[r.players[2].id],word);
    assert.equal(r.phase,'mining');
  }
  for(const word of ['','   ','а'.repeat(21),'а'.repeat(10)+' '+'б'.repeat(10)]) {
    const r=setup();begin(r);
    assert.throws(()=>act(r,'token-2','mine',{word},1001),/от 1 до 20 символов/);
    assert.equal(r.phase,'mining');assert.deepEqual(r.round.mines,{});
  }
});
test('redacts secrets from the active pair, player credentials and custom dictionary',()=>{
  const r=setup(4,{customWords:'Только секретный словарь'});begin(r);
  act(r,'token-2','mine',{word:'ловушка'},1001);
  const guesser=view(r,'token-1');
  assert.equal(guesser.round.word,null);assert.equal(guesser.round.mines,null);assert.equal(guesser.round.myMine,null);
  assert.equal(guesser.settings.customWords,'');
  assert.ok(!JSON.stringify(guesser).includes('token-'));assert.ok(!JSON.stringify(guesser).includes(r.round.word));
  const explainer=view(r,'token-0');assert.equal(explainer.round.word,r.round.word);assert.equal(explainer.round.mines,null);
  assert.equal(view(r,'token-2').round.myMine,'ловушка');assert.equal(view(r,'token-3').round.myMine,null);
  assert.throws(()=>view(r,'invalid'),/снова/);
});
test('miners see submitted mines before submitting their own and throughout the turn',()=>{
  const r=setup(4);begin(r);
  assert.deepEqual(view(r,'token-3').round.mines,{});
  act(r,'token-2','mine',{word:'ловушка'},1001);
  assert.equal(r.phase,'mining');
  assert.equal(view(r,'token-3').round.myMine,null);
  assert.deepEqual(view(r,'token-3').round.mines,{[r.players[2].id]:'ловушка'});
  act(r,'token-3','mine',{word:'опасность'},1002);
  assert.equal(r.phase,'mining');
  tick(r,r.round.deadline);
  assert.equal(r.phase,'explaining');
  const checkVisibility=()=>{
    for(const token of ['token-2','token-3']) assert.deepEqual(view(r,token).round.mines,r.round.mines);
    for(const token of ['token-0','token-1']) assert.equal(view(r,token).round.mines,null);
    assert.equal(view(r,'token-1').round.word,null);
  };
  checkVisibility();
  act(r,'token-2','claim',{},1003);checkVisibility();
  act(r,'token-0','resolve',{accept:false},1004);checkVisibility();
  act(r,'token-0','guessed',{},1005);
  for(const p of r.players)assert.deepEqual(view(r,p.token).round.mines,r.round.mines);
  act(r,'token-0','next',{},1006);
  assert.equal(view(r,'token-0').round.role,'miner');
  assert.deepEqual(view(r,'token-0').round.mines,{});
  const nextGuesser=r.players.find(p=>p.id===r.round.guesserId);
  assert.equal(view(r,nextGuesser.token).round.role,'guesser');
  assert.equal(view(r,nextGuesser.token).round.mines,null);
});
test('correct guesses score exactly once; roles rotate and game finishes',()=>{
  const r=setup(3,{useDefaultWords:false,customWords:'Ёлка, Самолёт, Кит'});begin(r);mine(r);
  act(r,'token-1','guess',{word:r.round.word.toLowerCase().replaceAll('ё','е')},1002);
  assert.equal(r.phase,'result');assert.deepEqual(r.players.map(p=>p.score),[1,1,0]);
  assert.throws(()=>act(r,'token-0','guessed',{},1003),/завершён/);
  act(r,'token-0','next',{},1004);
  assert.notEqual(r.round.explainerId,r.players[0].id);assert.notEqual(r.round.guesserId,r.players[1].id);
  for(let i=0;i<2;i++){act(r,'token-0','skip',{},1005);act(r,'token-0','next',{},1006);}
  assert.equal(r.phase,'finished');assert.equal(r.turn,3);
});
test('mine claims keep guessing untimed; duplicate mines are case insensitive',()=>{
  const r=setup(4);begin(r);
  act(r,'token-2','mine',{word:'ловушка'},1001);act(r,'token-3','mine',{word:'ЛОВУШКА'},1001);
  tick(r,r.round.deadline);
  act(r,'token-2','claim',{},2000);
  assert.equal(r.phase,'claim');assert.equal(r.round.deadline,null);assert.equal(tick(r,999999),false);
  assert.throws(()=>act(r,'token-2','resolve',{accept:true},3000),/ведущему/);
  act(r,'token-0','resolve',{accept:false},4000);assert.equal(r.round.deadline,null);
  assert.equal(tick(r,999999),false);assert.equal(r.phase,'explaining');
  act(r,'token-3','claim',{},4001);act(r,'token-0','resolve',{accept:true},4002);
  assert.equal(r.phase,'result');assert.deepEqual(r.players.map(p=>p.score),[0,0,1,1]);
});
test('mining lasts 60 seconds and guessing never times out',()=>{
  const r=setup(3,{miningDuration:15,duration:15});begin(r);
  assert.equal(r.round.deadline,61000);
  assert.equal(tick(r,60999),false);assert.equal(r.phase,'mining');
  assert.equal(tick(r,61000),true);assert.equal(r.phase,'explaining');assert.equal(r.round.deadline,null);
  tick(r,1000000000);assert.equal(r.phase,'explaining');
  act(r,'token-1','guess',{word:r.round.word},1000000000);assert.equal(r.phase,'result');
  const offline=setup();begin(offline);tick(offline,1000000);assert.equal(offline.phase,'explaining');
});
test('existing rooms adopt the new timers without ending their current turn',()=>{
  const mining=setup();begin(mining);
  mining.settings.duration=90;mining.settings.miningDuration=15;mining.round.deadline=16000;
  assert.equal(tick(mining,20000),true);assert.equal(mining.round.deadline,61000);assert.equal(mining.phase,'mining');
  const explaining=setup();begin(explaining);mine(explaining);
  explaining.settings.duration=90;explaining.round.deadline=91001;
  tick(explaining,999999);assert.equal(explaining.phase,'explaining');assert.equal(explaining.round.deadline,null);
  explaining.phase='claim';explaining.round.claim={playerId:explaining.players[2].id,word:'ловушка',remaining:10000};
  act(explaining,'token-0','resolve',{accept:false},1000000);assert.equal(explaining.round.deadline,null);
});
test('answers ignore upper/lower case and ё/е in either direction',()=>{
  for(const [word,answer] of [['Самолёт','САМОЛЁТ'],['Самолёт','самолет'],['самолёт','СаМоЛёТ'],['САМОЛЕТ','Самолёт']]) {
    const r=setup(3,{useDefaultWords:false,customWords:word});begin(r);mine(r);
    act(r,'token-1','guess',{word:answer},1002);assert.equal(r.phase,'result');assert.equal(r.round.result.outcome,'guessed');
  }
  const r=setup(3,{useDefaultWords:false,customWords:'Самолёт'});begin(r);
  assert.throws(()=>act(r,'token-2','mine',{word:'САМОЛЕТ'},1001),/не может быть миной/);
});
test('leaving transfers hosting and pauses an interrupted game below three players',()=>{
  const r=setup();begin(r);act(r,'token-0','leave',{},1001);
  assert.equal(r.hostId,r.players[0].id);assert.equal(r.phase,'paused');assert.equal(r.round,null);
  assert.throws(()=>view(r,'token-0'));
});

function memoryStore() {
  const records=new Map();
  return {
    async create(room){if(records.has(room.code))return false;records.set(room.code,{room:structuredClone(room),version:0,updated:Date.now()});return true;},
    async get(code){return structuredClone(records.get(code));},
    async save(room,version,now){const old=records.get(room.code);if(old.version!==version)return false;records.set(room.code,{room:structuredClone(room),version:version+1,updated:now});return true;}
  };
}
async function call(store,path,data,token) {
  const response=await api(new Request('http://localhost'+path,{method:data?'POST':'GET',headers:{...(token&&{Authorization:`Bearer ${token}`})},...(data&&{body:JSON.stringify(data)})}),store);
  return {status:response.status,...await response.json()};
}
test('API supports code-only joins while requiring a session for state access',async()=>{
  const store=memoryStore();
  assert.equal((await call(store,'/api/rooms',{name:''})).status,400);
  const created=await call(store,'/api/rooms',{name:'Host'});
  assert.equal(created.status,201);
  assert.match(created.room.code,/^[0-9]{4}$/);
  assert.equal((await call(store,`/api/rooms/${created.room.code}`)).status,401);
  const guest=await call(store,`/api/rooms/${created.room.code}/join`,{name:'Guest'});
  assert.equal(guest.status,200);
  assert.equal((await call(store,`/api/rooms/${created.room.code}`,null,guest.token)).room.players.length,2);
  assert.equal((await call(store,`/api/rooms/${created.room.code}`,null,created.token)).room.me,created.room.me);
  assert.equal((await call(store,`/api/rooms/${created.room.code}/action`,{action:'leave'},created.token)).left,true);
});
test('four-digit codes preserve leading zeros and retry collisions without overwriting rooms',async()=>{
  const store=memoryStore();
  const seeded=createRoom('0275',newPlayer('Host','original-token'),{},Date.now());await store.create(seeded);
  const joined=await call(store,'/api/rooms/0275/join',{name:'Guest'});
  assert.equal(joined.status,200);assert.equal(joined.room.code,'0275');
  let attempts=0;
  const colliding={...store,async create(room){assert.match(room.code,/^[0-9]{4}$/);return ++attempts<=5?false:store.create(room);}};
  const created=await call(colliding,'/api/rooms',{name:'New Host'});
  assert.equal(created.status,201);assert.equal(attempts,6);assert.match(created.room.code,/^[0-9]{4}$/);
  assert.equal((await call(store,'/api/rooms/0275',null,'original-token')).room.players.length,2);
  for(const invalid of ['123','12345','12a4'])assert.equal((await call(store,`/api/rooms/${invalid}`)).status,404);
});
test('concurrent API joins and mine submissions are not lost',async()=>{
  const store=memoryStore(),created=await call(store,'/api/rooms',{name:'Host'});
  const base=`/api/rooms/${created.room.code}`;
  const joins=await Promise.all(Array.from({length:12},(_,i)=>call(store,base+'/join',{name:'Guest '+i})));
  assert.ok(joins.every(j=>j.status===200));
  const tokens=[created.token,...joins.map(j=>j.token)];
  await Promise.all(tokens.map(token=>call(store,base+'/action',{action:'ready'},token)));
  assert.equal((await call(store,base+'/action',{action:'start'},created.token)).room.phase,'mining');
  const state=(await store.get(created.room.code)).room;
  const miners=state.players.filter(p=>![state.round.explainerId,state.round.guesserId].includes(p.id));
  const results=await Promise.all(miners.map(p=>call(store,base+'/action',{action:'mine',data:{word:'ловушка'}},p.token)));
  assert.ok(results.every(r=>r.status===200));
  const final=await call(store,base,null,created.token);
  assert.equal(final.room.phase,'mining');assert.equal(final.room.round.mineCount,11);assert.equal(final.room.players.length,13);
});

test('built-in vocabulary contains exactly 500 distinct playable words',()=>{
  assert.equal(WORDS.length,500);
  assert.equal(new Set(WORDS.map(w=>w.toLowerCase().replaceAll('ё','е'))).size,500);
  assert.ok(WORDS.every(w=>w===w.trim() && w.length>0 && w.length<=60 && !w.includes('_')));
});
test('only the explainer can redraw before the first mine without advancing roles or scores',()=>{
  const r=setup(4);begin(r);
  const previous=structuredClone(r);
  assert.equal(view(r,'token-0').round.canRedraw,true);
  for(const token of ['token-1','token-2']) {
    assert.equal(view(r,token).round.canRedraw,false);
    assert.throws(()=>act(r,token,'redraw',{roundId:r.round.id},1001),/только объясняющий/);
  }
  act(r,'token-0','redraw',{roundId:previous.round.id},2000);
  assert.equal(r.phase,'mining');assert.notEqual(r.round.word,previous.round.word);
  assert.notEqual(r.round.id,previous.round.id);assert.equal(r.round.deadline,62000);
  assert.equal(r.round.explainerId,previous.round.explainerId);assert.equal(r.round.guesserId,previous.round.guesserId);
  assert.equal(r.turn,previous.turn);assert.equal(r.totalTurns,previous.totalTurns);
  assert.deepEqual(r.schedule,previous.schedule);assert.deepEqual(r.progress,previous.progress);
  assert.deepEqual(r.players,previous.players);assert.deepEqual(r.round.mines,{});
  assert.ok(r.used.includes(previous.round.word));assert.ok(r.used.includes(r.round.word));
  assert.equal(view(r,'token-1').round.word,null);
  assert.throws(()=>act(r,'token-0','redraw',{roundId:previous.round.id},2001),/ход уже сменился/);
  assert.throws(()=>act(r,'token-0','redraw',{},2001),/ход уже сменился/);
  assert.throws(()=>act(r,'token-2','mine',{word:'ловушка',roundId:previous.round.id},2001),/ход уже сменился/);
});
test('redraw uses custom words, avoids the current word on exhaustion and handles a single unique word',()=>{
  const r=setup(3,{useDefaultWords:false,customWords:'Кит, Дом'});begin(r);
  const first=r.round.word;
  act(r,'token-0','redraw',{roundId:r.round.id},1001);assert.notEqual(r.round.word,first);
  act(r,'token-0','redraw',{roundId:r.round.id},1002);assert.equal(r.round.word,first);
  for(const customWords of ['Кит','Ёлка, ЕЛКА']) {
    const single=setup(3,{useDefaultWords:false,customWords});begin(single);
    assert.equal(view(single,'token-0').round.canRedraw,false);
    const previous=structuredClone(single.round);
    assert.throws(()=>act(single,'token-0','redraw',{roundId:single.round.id},1001),/нет другого слова/);
    assert.deepEqual(single.round,previous);
  }
});
test('the first mine locks redraw even if its author leaves, including older rooms',()=>{
  for(const legacy of [false,true]) {
    const r=setup(4);begin(r);
    act(r,'token-2','mine',{word:'ловушка'},1001);
    if(legacy) delete r.round.redrawLocked;
    assert.equal(view(r,'token-0').round.canRedraw,false);
    assert.throws(()=>act(r,'token-0','redraw',{roundId:r.round.id},1002),/Первая мина/);
    act(r,'token-2','leave',{},1003);
    assert.deepEqual(r.round.mines,{});assert.equal(r.phase,'mining');
    assert.equal(view(r,'token-0').round.canRedraw,false);
    assert.throws(()=>act(r,'token-0','redraw',{roundId:r.round.id},1004),/Первая мина/);
  }
});
test('mine replacements stay editable for all 60 seconds and freeze exactly at the deadline',()=>{
  const r=setup(4,{useDefaultWords:false,customWords:'Самолёт'});begin(r);
  const deadline=r.round.deadline;
  act(r,'token-2','mine',{word:'крыло'},1001);
  act(r,'token-3','mine',{word:'пилот'},1002);
  assert.equal(r.phase,'mining');assert.equal(r.round.deadline,deadline);
  act(r,'token-2','mine',{word:'аэропорт'},deadline-1);
  assert.equal(r.phase,'mining');assert.equal(r.round.deadline,deadline);
  assert.equal(view(r,'token-2').round.mineCount,2);
  assert.equal(view(r,'token-3').round.mines[r.players[2].id],'аэропорт');
  assert.equal(view(r,'token-0').round.mines,null);assert.equal(view(r,'token-1').round.mines,null);
  for(const word of ['', 'а'.repeat(21),'САМОЛЕТ']) {
    assert.throws(()=>act(r,'token-2','mine',{word},deadline-1));
    assert.equal(r.round.mines[r.players[2].id],'аэропорт');
  }
  assert.throws(()=>act(r,'token-0','mine',{word:'чужая'},deadline-1),/только минёры/);
  assert.throws(()=>act(r,'token-2','mine',{word:'поздно'},deadline),/завершено/);
  assert.equal(r.phase,'explaining');assert.equal(r.round.deadline,null);
  assert.equal(view(r,'token-0').round.canRedraw,false);
  assert.throws(()=>act(r,'token-0','redraw',{roundId:r.round.id},deadline),/до установки мин/);
  act(r,'token-2','claim',{},deadline+1);
  assert.equal(r.round.claim.word,'аэропорт');
});
test('redraw is unavailable once the 60 seconds expire even without any mines',()=>{
  const r=setup();begin(r);const previous=structuredClone(r.round);
  assert.throws(()=>act(r,'token-0','redraw',{roundId:r.round.id},r.round.deadline),/до установки мин/);
  assert.equal(r.phase,'explaining');assert.equal(r.round.word,previous.word);
  assert.equal(r.round.id,previous.id);assert.equal(view(r,'token-0').round.canRedraw,false);
});
test('a concurrent redraw and first mine cannot apply to different words',async()=>{
  const store=memoryStore(),created=await call(store,'/api/rooms',{name:'Host'});
  const base=`/api/rooms/${created.room.code}`;
  await call(store,base+'/join',{name:'Guesser'});
  const miner=await call(store,base+'/join',{name:'Miner'});
  const started=await call(store,base+'/action',{action:'start'},created.token);
  const roundId=started.room.round.id;
  const outcomes=await Promise.all([
    call(store,base+'/action',{action:'redraw',data:{roundId}},created.token),
    call(store,base+'/action',{action:'mine',data:{roundId,word:'ловушка'}},miner.token)
  ]);
  assert.equal(outcomes.filter(r=>r.status===200).length,1);
  assert.ok(outcomes.some(r=>r.status===400||r.status===409));
  const final=(await store.get(created.room.code)).room;
  if(final.round.id===roundId) assert.equal(final.round.mines[miner.room.me],'ловушка');
  else {assert.notEqual(final.round.word,started.room.round.word);assert.deepEqual(final.round.mines,{});}
});
