import test from 'node:test';
import assert from 'node:assert/strict';
import { act, checkPassword, createRoom, joinRoom, newPlayer, settings, tick, view } from '../src/game.js';
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
}
test('fixed password is validated server-side',()=>{
  checkPassword('ACM');checkPassword('acm');
  for(const password of ['','wrong','ACM ',null,{},123]) assert.throws(()=>checkPassword(password),/пароль/);
});
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
    assert.equal(r.phase,'explaining');
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
  act(r,'token-2','claim',{},2000);
  assert.equal(r.phase,'claim');assert.equal(r.round.deadline,null);assert.equal(tick(r,999999),false);
  assert.throws(()=>act(r,'token-2','resolve',{accept:true},3000),/ведущему/);
  act(r,'token-0','resolve',{accept:false},4000);assert.equal(r.round.deadline,null);
  assert.equal(tick(r,999999),false);assert.equal(r.phase,'explaining');
  act(r,'token-3','claim',{},4001);act(r,'token-0','resolve',{accept:true},4002);
  assert.equal(r.phase,'result');assert.deepEqual(r.players.map(p=>p.score),[0,0,1,1]);
});
test('mining lasts up to 60 seconds and guessing never times out',()=>{
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
test('API rejects bad password and unauthenticated state access',async()=>{
  const store=memoryStore();
  assert.equal((await call(store,'/api/rooms',{name:'Host',password:'bad'})).status,403);
  const created=await call(store,'/api/rooms',{name:'Host',password:'ACM'});
  assert.equal(created.status,201);
  assert.match(created.room.code,/^[0-9]{4}$/);
  assert.equal((await call(store,`/api/rooms/${created.room.code}`)).status,401);
  assert.equal((await call(store,`/api/rooms/${created.room.code}/join`,{name:'Guest',password:'bad'})).status,403);
  assert.equal((await call(store,`/api/rooms/${created.room.code}`,null,created.token)).room.me,created.room.me);
  assert.equal((await call(store,`/api/rooms/${created.room.code}/action`,{action:'leave'},created.token)).left,true);
});
test('four-digit codes preserve leading zeros and retry collisions without overwriting rooms',async()=>{
  const store=memoryStore();
  const seeded=createRoom('0275',newPlayer('Host','original-token'),{},Date.now());await store.create(seeded);
  const joined=await call(store,'/api/rooms/0275/join',{name:'Guest',password:'ACM'});
  assert.equal(joined.status,200);assert.equal(joined.room.code,'0275');
  let attempts=0;
  const colliding={...store,async create(room){assert.match(room.code,/^[0-9]{4}$/);return ++attempts<=5?false:store.create(room);}};
  const created=await call(colliding,'/api/rooms',{name:'New Host',password:'ACM'});
  assert.equal(created.status,201);assert.equal(attempts,6);assert.match(created.room.code,/^[0-9]{4}$/);
  assert.equal((await call(store,'/api/rooms/0275',null,'original-token')).room.players.length,2);
  for(const invalid of ['123','12345','12a4'])assert.equal((await call(store,`/api/rooms/${invalid}`)).status,404);
});
test('concurrent API joins and mine submissions are not lost',async()=>{
  const store=memoryStore(),created=await call(store,'/api/rooms',{name:'Host',password:'acm'});
  const base=`/api/rooms/${created.room.code}`;
  const joins=await Promise.all(Array.from({length:12},(_,i)=>call(store,base+'/join',{name:'Guest '+i,password:'ACM'})));
  assert.ok(joins.every(j=>j.status===200));
  const tokens=[created.token,...joins.map(j=>j.token)];
  await Promise.all(tokens.map(token=>call(store,base+'/action',{action:'ready'},token)));
  assert.equal((await call(store,base+'/action',{action:'start'},created.token)).room.phase,'mining');
  const state=(await store.get(created.room.code)).room;
  const miners=state.players.filter(p=>![state.round.explainerId,state.round.guesserId].includes(p.id));
  const results=await Promise.all(miners.map(p=>call(store,base+'/action',{action:'mine',data:{word:'ловушка'}},p.token)));
  assert.ok(results.every(r=>r.status===200));
  const final=await call(store,base,null,created.token);
  assert.equal(final.room.phase,'explaining');assert.equal(final.room.round.mineCount,11);assert.equal(final.room.players.length,13);
});
