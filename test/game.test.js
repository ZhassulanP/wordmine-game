import test from 'node:test';
import assert from 'node:assert/strict';
import { act, checkPassword, createRoom, joinRoom, newPlayer, settings, tick, view } from '../src/game.js';
import { api } from '../src/api.js';

function setup(count=3, options={}) {
  const players=Array.from({length:count},(_,i)=>newPlayer(`Игрок ${i+1}`,`token-${i}`));
  const room=createRoom('ABC234',players[0],options,1000);
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
  for(const options of [{capacity:2},{capacity:3.5},{capacity:-1},{duration:0},{cycles:0},{useDefaultWords:false}])assert.throws(()=>settings(options));
  assert.deepEqual(settings({customWords:'Кот, Кит\nКот; Дом'}).customWords,['Кот','Кит','Дом']);
  const r=setup();assert.throws(()=>act(r,'token-1','settings',{}),/ведущему/);
});
test('requires three ready players and host authorization',()=>{
  const r=setup();assert.throws(()=>act(r,'token-0','start'),/готовности/);
  assert.throws(()=>act(r,'token-1','start'),/ведущему/);
  begin(r);assert.equal(r.phase,'mining');
  assert.throws(()=>joinRoom(r,newPlayer('Поздно','late')),/уже идёт/);
  assert.throws(()=>act(r,'token-1','mine',{word:'ловушка'},1001),/минёры/);
});
test('redacts secrets, other mines, player credentials and custom dictionary',()=>{
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
test('correct guesses score exactly once; roles rotate and game finishes',()=>{
  const r=setup(3,{useDefaultWords:false,customWords:'Ёлка, Самолёт, Кит'});begin(r);mine(r);
  act(r,'token-1','guess',{word:r.round.word.toLowerCase().replaceAll('ё','е')},1002);
  assert.equal(r.phase,'result');assert.deepEqual(r.players.map(p=>p.score),[1,1,0]);
  assert.throws(()=>act(r,'token-0','guessed',{},1003),/завершён/);
  act(r,'token-0','next',{},1004);
  assert.equal(r.round.explainerId,r.players[1].id);assert.equal(r.round.guesserId,r.players[2].id);
  for(let i=0;i<2;i++){act(r,'token-0','skip',{},1005);act(r,'token-0','next',{},1006);}
  assert.equal(r.phase,'finished');assert.equal(r.turn,3);
});
test('mine claim pauses timer; host rejects or confirms duplicate mines',()=>{
  const r=setup(4);begin(r);
  act(r,'token-2','mine',{word:'ловушка'},1001);act(r,'token-3','mine',{word:'ЛОВУШКА'},1001);
  const deadline=r.round.deadline;act(r,'token-2','claim',{},2000);
  assert.equal(r.phase,'claim');assert.equal(r.round.deadline,null);assert.equal(tick(r,999999),false);
  assert.throws(()=>act(r,'token-2','resolve',{accept:true},3000),/ведущему/);
  act(r,'token-0','resolve',{accept:false},4000);assert.equal(r.round.deadline,deadline+2000);
  act(r,'token-3','claim',{},4001);act(r,'token-0','resolve',{accept:true},4002);
  assert.equal(r.phase,'result');assert.deepEqual(r.players.map(p=>p.score),[0,0,1,1]);
});
test('server deadlines advance even after all browsers were away',()=>{
  const r=setup(3,{miningDuration:15,duration:15});begin(r);
  assert.equal(tick(r,16000),true);assert.equal(r.phase,'explaining');assert.equal(r.round.deadline,31000);
  tick(r,31000);assert.equal(r.phase,'result');assert.equal(r.round.result.outcome,'timeout');
  const offline=setup(3,{miningDuration:15,duration:15});begin(offline);tick(offline,1000000);assert.equal(offline.phase,'result');
});
test('leaving transfers hosting and resets an interrupted game',()=>{
  const r=setup();begin(r);act(r,'token-0','leave',{},1001);
  assert.equal(r.hostId,r.players[0].id);assert.equal(r.phase,'lobby');assert.equal(r.round,null);
  assert.ok(r.players.every(p=>!p.ready));assert.throws(()=>view(r,'token-0'));
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
  assert.equal((await call(store,`/api/rooms/${created.room.code}`)).status,401);
  assert.equal((await call(store,`/api/rooms/${created.room.code}/join`,{name:'Guest',password:'bad'})).status,403);
  assert.equal((await call(store,`/api/rooms/${created.room.code}`,null,created.token)).room.me,created.room.me);
  assert.equal((await call(store,`/api/rooms/${created.room.code}/action`,{action:'leave'},created.token)).left,true);
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
