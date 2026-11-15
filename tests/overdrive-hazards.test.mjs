import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';
const {OVERDRIVE_KINDS,makeOverdrive,overdriveSafe,overdriveContact,applyOverdriveMotion,threatSegment,updateOverdrive}=loadModule('shared/overdriveHazards');
const {createBody,moveBody,activateDash}=loadModule('shared/movement');
const {RuleEngine,RULE_DEFS,compatible}=loadModule('shared/ruleEngine');
const {SAFE_PAIRS}=loadModule("shared/comboSafety");
const {Room}=loadModule('shared/room');
const bodies=()=>Array.from({length:8},(_,i)=>({...createBody(580+130*Math.cos(i*Math.PI/4),399+100*Math.sin(i*Math.PI/4)),id:`p${i}`}));
const rng={pick:v=>v[0],between:min=>min,shuffle:v=>v};
for(const [index,kind] of OVERDRIVE_KINDS.entries()) {
 test(`${kind}: eight players have whole-scenario routes, including reaction and active Dash`,()=>{
  for(const mode of ['classic','survival','blitz','chaos','lastOneStanding']) for(const inset of [0,90]) {
   const p=bodies(),l=makeOverdrive(kind,p,2,mode,inset,0);assert.ok(l,`${mode}/${inset}`);assert.equal(l.safe.length,8);
   p.forEach((b,i)=>{b.vx=345;b.vy=0;activateDash(b,{x:1,y:0});});
   for(let t=0;t<l.duration;t+=.02) p.forEach((b,i)=>{
    const previous={x:b.x,y:b.y},q=l.safe[i],d=Math.hypot(b.x-q.x,b.y-q.y);
    const input=t<.3||d<3?{x:0,y:0}:{x:(q.x-b.x)/d,y:(q.y-b.y)/d};
    moveBody(b,input,.02);applyOverdriveMotion(l,b,t,.02);
    assert.equal(overdriveContact(l,b,t,.02,previous),false,`${kind}/${mode}/${t}/${i}`);
   });
   p.forEach((b,i)=>{assert.ok(overdriveSafe(l,l.safe[i],b.radius));assert.ok(Math.hypot(b.x-l.safe[i].x,b.y-l.safe[i].y)<5);});
  }
  assert.equal(makeOverdrive(kind,bodies(),2,'chaos',600,0),undefined);
 });
 test(`${kind}: warning, mechanics, swept collision, completion and real selection`,()=>{
  const p=bodies(),l=makeOverdrive(kind,p,1,'blitz',0,0),h=l.threats.find(h=>h.force===undefined);
  assert.ok(l);assert.ok(l.threats.length<=48);
  if(h) {
   const s=threatSegment(h,h.active+.05),b={...p[0],x:(s.x1+s.x2)/2,y:(s.y1+s.y2)/2};
   assert.equal(overdriveContact(l,b,h.active-.01),false);
   assert.equal(overdriveContact(l,b,h.active+.05),true);
   assert.equal(overdriveContact(l,b,l.duration+.1),false);
  }
  if(kind==='gravityPulse'||kind==='blackHole') {
   const field=l.threats.find(h=>h.force!==undefined),b=createBody(field.a.x+70,field.a.y),before=b.x;
   applyOverdriveMotion(l,b,1,.05);assert.equal(b.x,before);
   applyOverdriveMotion(l,b,2.5,.05);assert.ok(kind==='gravityPulse'?b.x>before:b.x<before);
  }
  const id=18+index,select={...rng,pick:v=>v.includes(id)?id:v[0],between:(min,max)=>max===99?99:min};
  const e=new RuleEngine(select,'classic');e.update(1,0,p,()=>{},()=>{});assert.equal(e.state.ids[0],id);
  e.update(2,2,p,()=>{},()=>{});assert.equal(e.state.overdrive.kind,kind);
  e.update(7,9,p,()=>false,()=>{});assert.equal(e.state.phase,'rest');assert.equal(e.state.overdrive,undefined);
  for(let other=0;other<RULE_DEFS.length;other++) assert.equal(compatible(id,other),SAFE_PAIRS.some(pair=>pair.includes(id)&&pair.includes(other)&&id!==other));
 });
 test(`${kind}: server snapshot, authoritative effects, eight players and repeated Rematch`,()=>{
  const room=new Room('ABC234',rng);
  for(let i=0;i<8;i++) room.join(`p${i}`,`secret${i}`,`Player ${i}`,0);
  for(let round=0;round<3;round++) {
   for(let i=0;i<8;i++) room.command(`p${i}`,{type:'ready',ready:true});room.command('p0',{type:'start'});
   for(let i=0;i<61;i++) room.tick(.05);
   room.rules.state.phase='announce';room.rules.state.ids=[18+index];room.rules.state.remaining=0;room.tick(.05);
   const l=room.rules.state.overdrive;assert.ok(l);
   const wire=JSON.parse(JSON.stringify(room.snapshot()));assert.equal(wire.protocol,8);assert.equal(wire.players.length,8);
   assert.deepEqual(wire.rules.overdrive,JSON.parse(JSON.stringify(l)));
   const h=l.threats.find(h=>h.force===undefined),b=room.members.get('p0').state;
   const impact=h?h.active:2.4;room.rules.state.elapsed=impact;room.rules.state.remaining=6.8-impact;
   if(h) {const s=threatSegment(h,impact+.05);Object.assign(b,{x:(s.x1+s.x2)/2,y:(s.y1+s.y2)/2});}
   else Object.assign(b,{x:l.threats[0].a.x+70,y:l.threats[0].a.y});
   const x=b.x;room.tick(.05);
   if(h) assert.ok(b.hp<3,'server damage without client claims');else assert.ok(b.x>x,'server force without client claims');
   for(const m of room.members.values()) m.state.hp=0;room.tick(.05);assert.equal(room.phase,'results');assert.equal(room.rules.state.overdrive,undefined);
   room.command('p0',{type:'rematch'});assert.equal(room.phase,'lobby');assert.equal(room.rules.state.overdrive,undefined);
  }
 });
}
test('moving wall and bullets cannot tunnel between ticks',()=>{
 for(const kind of ['movingWalls','bulletStorm']) {
  const l=makeOverdrive(kind,bodies(),2,'blitz',0,0),h=l.threats[0],time=h.active+.2;
  const a=threatSegment(h,time-.1),b=threatSegment(h,time);
  const p={...createBody(),x:(a.x1+b.x1)/2,y:kind==='movingWalls'?(a.y1+a.y2)/2:a.y1,hp:3};
  assert.equal(overdriveContact({...l,threats:[h]},p,time,.1),true);
 }
});

test('Overdrive rendering preserves warnings on Low, localizes every event and has bounded work',()=>{
 const calls=[],g=new Proxy({}, {get:(_,method)=>(...args)=>{calls.push(method);return g;}});
 const locales=loadModule('locales/index'),effects=loadModule('effects');
 const {RuleView,ruleTitle,ruleSubtitle,ruleStatus}=loadModule('ruleView',{}, {phaser:{default:{}},'./locales':locales,'./effects':effects});
 const view=new RuleView({add:{graphics:()=>g,text:()=>g}});
 for(const [i,kind] of OVERDRIVE_KINDS.entries()) {
  const s={...new RuleEngine(rng).state,phase:'active',ids:[18+i],remaining:6.8,overdrive:makeOverdrive(kind,bodies(),2,'chaos',0,0)};
  for(const locale of ['ru','en']) {locales.setLocale(locale);assert.ok(ruleTitle(s));assert.ok(ruleSubtitle(s));assert.ok(ruleStatus(s));}
  for(const intensity of ['low','medium','high']) for(const elapsed of [.5,2.5,4.5]) {
   effects.setEffects(intensity);calls.length=0;s.elapsed=elapsed;view.draw(s);
   assert.ok(calls.includes('strokeCircle'));assert.ok(calls.length<500,`${kind}/${intensity}/${calls.length}`);
  }
  s.phase='rest';calls.length=0;view.draw(s);assert.equal(calls.filter(x=>x==='fillCircle'||x==='lineBetween').length,0);
 }
});
test('Black Hole remains escapable by normal movement without Dash; pulse has no direct damage',()=>{
 const l=makeOverdrive('blackHole',bodies(),2,'chaos',0,0),field=l.threats[0],b=createBody(field.a.x+65,field.a.y);
 for(let i=0;i<100;i++) {moveBody(b,{x:1,y:0},.02);applyOverdriveMotion(l,b,2.4+i*.02,.02);}
 assert.ok(b.x-field.a.x>field.radius);
 const pulse=makeOverdrive('gravityPulse',bodies(),2,'chaos',0,0);
 assert.equal(overdriveContact(pulse,{...b,x:pulse.threats[0].a.x+20,y:pulse.threats[0].a.y},2.5),false);
});
test('new layouts reject client injection; protocol v8 is required for new snapshots',()=>{
 const {parseClientMessage,PROTOCOL_VERSION}=loadModule('shared/protocol');assert.equal(PROTOCOL_VERSION,8);
 assert.equal(parseClientMessage(JSON.stringify({type:'input',x:0,y:0,overdrive:{}})),null);
});
test('all eight new hazards enter ordinary seeded rotation without repeating recent primary IDs',()=>{
 const {seededRandom}=loadModule('shared/offlineProgress'),e=new RuleEngine(seededRandom(219),'classic');let ids=[],seen=new Set();
 for(let i=0;i<150;i++) {
  e.state.phase='rest';e.state.remaining=0;e.update(.01,0,bodies(),()=>{},()=>{});
  const id=e.state.ids[0];assert.equal(ids.slice(-4).includes(id),false);ids.push(id);seen.add(id);
 }
 for(let i=18;i<26;i++) assert.ok(seen.has(i));
});
test('accepted layouts remain escapable from arena edges with boosted drift, Dash and contraction',()=>{
 const {ARENA}=loadModule('config');let accepted=0;
 for(const kind of OVERDRIVE_KINDS) for(let rotation=0;rotation<6;rotation++) {
  const p=[{...createBody(ARENA.left+15,ARENA.top+15),id:'a'},{...createBody(ARENA.right-15,ARENA.bottom-15),id:'b'}];
  const l=makeOverdrive(kind,p,2,'chaos',0,rotation);if(!l) continue;accepted++;
  p.forEach((b,i)=>{const q=l.safe[i],d=Math.hypot(q.x-b.x,q.y-b.y)||1;b.speedTime=5;b.vx=-(q.x-b.x)/d*345;b.vy=-(q.y-b.y)/d*345;b.dashTime=.16;b.dashX=-(q.x-b.x)/d;b.dashY=-(q.y-b.y)/d;});
  for(let time=0;time<l.duration;time+=.01) p.forEach((b,i)=>{
   const q=l.safe[i],d=Math.hypot(q.x-b.x,q.y-b.y),previous={x:b.x,y:b.y};
   moveBody(b,time<.3?{x:b.dashX,y:b.dashY}:d>2?{x:(q.x-b.x)/d,y:(q.y-b.y)/d}:{x:0,y:0},.01);
   applyOverdriveMotion(l,b,time,.01);assert.equal(overdriveContact(l,b,time,.01,previous),false);
   if(time>=l.warning){assert.ok(b.x-b.radius>ARENA.left+time*1.5);assert.ok(b.x+b.radius<ARENA.right-time*1.5);assert.ok(b.y-b.radius>ARENA.top+time*.9);assert.ok(b.y+b.radius<ARENA.bottom-time*.9);}
  });
 }
 assert.ok(accepted>=40,'conservative rejection must not disable ordinary edge spawns');
});
test('reconnect preserves active Overdrive parameters and does not restart the hazard',()=>{
 const r=new Room('ABC234',rng);for(let i=0;i<8;i++)r.join(`p${i}`,`secret${i}`,`Player ${i}`,0);
 for(let i=0;i<8;i++)r.command(`p${i}`,{type:'ready',ready:true});r.command('p0',{type:'start'});for(let i=0;i<61;i++)r.tick(.05);
 r.rules.state.phase='announce';r.rules.state.ids=[18];r.rules.state.remaining=0;r.tick(.05);
 const layout=JSON.stringify(r.rules.state.overdrive),serial=r.rules.state.serial;
 r.disconnect('p0');assert.equal(r.join('new','new','Recovered',0,'wrong'),'connectionLost');
 const recovered=r.join('new','new','Recovered',0,'secret0');assert.equal(recovered.id,'p0');
 assert.equal(JSON.stringify(r.rules.state.overdrive),layout);assert.equal(r.rules.state.serial,serial);assert.equal(r.members.size,8);
 assert.equal(JSON.stringify(r.snapshot()).includes('secret0'),false);
});
test('generation and collision work remains bounded for eight-player Bullet Storm',()=>{
 let calls=0;const math=new Proxy(Math,{get:(target,key)=>key==='hypot'?(...args)=>{calls++;return Math.hypot(...args);}:Reflect.get(target,key)});
 const measured=loadModule('shared/overdriveHazards',{Math:math}),p=bodies();
 const l=measured.makeOverdrive('bulletStorm',p,2,'chaos',0,0);assert.ok(l);assert.ok(calls<100000,`${calls} geometry operations`);
 calls=0;for(const b of p) measured.overdriveContact(l,b,3,.05,{x:b.x-46,y:b.y});
 assert.ok(calls<20000,`${calls} collision operations`);assert.ok(l.threats.length<=48);
});
test('Minefield proximity ignites a delayed chain, with reaction time and invariant refuges',()=>{
 const l=makeOverdrive('minefield',bodies(),2,'chaos',0,0),mine=l.threats[2],p={...createBody(mine.a.x,mine.a.y),id:'trigger'};
 const initial=mine.active;updateOverdrive(l,[p],1);assert.equal(mine.active,initial);
 updateOverdrive(l,[p],2.4);assert.equal(mine.active,3.2);
 assert.ok(l.threats[1].active>mine.active);assert.ok(l.threats[3].active>mine.active);
 assert.equal(overdriveContact(l,p,3.19),false);assert.equal(overdriveContact(l,p,3.21),true);
 for(const q of l.safe) assert.ok(overdriveSafe(l,q,12));
 const before=l.threats.map(h=>h.active);updateOverdrive(l,[p],2.45);assert.deepEqual(l.threats.map(h=>h.active),before);
});
test('solid Moving Walls and Arena Split stop crossing, but preserve their open passage',()=>{
 for(const kind of ['movingWalls','arenaSplit']) {
  const l=makeOverdrive(kind,bodies(),2,'chaos',0,0),h=l.threats[0],time=h.active+.1,line=threatSegment(h,time);
  const previous={x:line.x1-45,y:(line.y1+line.y2)/2},b=createBody(line.x1+45,previous.y);
  b.vx=920;applyOverdriveMotion(l,b,time,.1,previous);
  assert.ok(b.x<line.x1);assert.equal(b.vx,0);assert.equal(overdriveContact(l,b,time),true);
  const crossing=createBody(line.x1+45,399);applyOverdriveMotion(l,crossing,time,.1,{x:line.x1-45,y:399});
  assert.equal(crossing.x,line.x1+45,'gap remains traversable');
 }
});
