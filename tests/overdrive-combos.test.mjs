import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './load.mjs';
const {RuleEngine}=loadModule('shared/ruleEngine');
const {NEW_PAIRS,NEW_TRIPLES,REJECTED_COMBOS,certifyCombo,jointlySafe,comboWarning,comboKey}=loadModule('shared/comboSafety');
const {createBody,moveBody}=loadModule('shared/movement');
const {applyOverdriveMotion}=loadModule('shared/overdriveHazards');
const {Room}=loadModule('shared/room');
const {overdrivePhase}=loadModule('shared/modes');
const rng=(rotation=0)=>({pick:v=>v[0],between:(min,max)=>max===5?rotation:min,shuffle:v=>v});
const players=()=>Array.from({length:8},(_,i)=>({...createBody(580+130*Math.cos(i*Math.PI/4),399+100*Math.sin(i*Math.PI/4)),id:`p${i}`}));
function start(ids,p=players(),inset=0,rotation=0,mode='chaos',time=70){
 const e=new RuleEngine(rng(rotation),mode);e.state.phase='announce';e.state.ids=[...ids];e.state.remaining=0;
 e.update(.01,time,p,()=>{},()=>{},()=>{},()=>{},1,inset);return e;
}
for(const ids of [...NEW_PAIRS,...NEW_TRIPLES]) {
 test(`extended ${comboKey(ids)}: union remains escapable with reaction, acceleration, Dash and moving threats`,()=>{
  let admitted=0;
  for(const inset of [0,90]) for(let rotation=0;rotation<3;rotation++) {
   const p=players(),e=start(ids,p,inset,rotation),s=e.state;
   if(!s.comboSafe) {assert.equal(s.ids.length,1);assert.equal(s.overdriveLayers,undefined);continue;}
   admitted++;assert.equal(s.ids.length,ids.length);assert.equal(s.comboSafe.length,8);
   const destinations=s.comboSafe.map(q=>({...q})),warning=comboWarning(s);
   p.forEach((b,i)=>{const q=destinations[i],d=Math.hypot(q.x-b.x,q.y-b.y)||1;b.dashTime=.16;b.speedTime=.3;b.dashX=-(q.x-b.x)/d;b.dashY=-(q.y-b.y)/d;});
   let hits=0;const duration=s.duration;
   for(let time=0;time<duration-.02;time+=.02) {
    const state=e.state;
    p.forEach((b,i)=>{
     const q=destinations[i],d=Math.hypot(q.x-b.x,q.y-b.y),previous={x:b.x,y:b.y};
     moveBody(b,time<.3?{x:b.dashX,y:b.dashY}:d>2?{x:(q.x-b.x)/d,y:(q.y-b.y)/d}:{x:0,y:0},.02);
     applyOverdriveMotion(state.overdriveLayers??state.overdrive,b,state.elapsed+.02,.02,previous);
    });
    e.update(.02,70+time,p,()=>{hits++;return false;},()=>{},()=>{},()=>{},1,inset+time*1.5);
    assert.equal(e.state.phase,'active','certificate must survive every active tick');
    for(const q of destinations) assert.ok(jointlySafe(e.state,q,12));
   }
   assert.equal(hits,0,'whole-scenario escape must not rely on damage immunity');
   p.forEach((b,i)=>assert.ok(Math.hypot(b.x-destinations[i].x,b.y-destinations[i].y)<3));
   assert.ok(warning>=2.8);
  }
  assert.ok(admitted>=3,'a candidate must actually run in representative eight-player layouts');
 });
 test(`extended ${comboKey(ids)}: all five modes certify the combined scenario`,()=>{
  for(const mode of ['classic','survival','blitz','chaos','lastOneStanding']) {
   const e=start(ids,players(),0,0,mode);assert.equal(e.state.ids.length,ids.length);assert.ok(e.state.comboSafe);
   const layers=e.state.overdriveLayers??[e.state.overdrive];
   assert.ok(layers.every(l=>l.threats.every(h=>h.end<=e.state.duration)));
  }
 });
}
test('unproved temporal candidates are rejected, rather than inferred safe from their parts',()=>{
 for(const ids of REJECTED_COMBOS) {
  const e=start(ids);assert.ok(e.state.ids.length<=1);assert.equal(e.state.comboSafe,undefined);assert.equal(e.state.overdriveLayers,undefined);
 }
});
test('whole-volume union rejects individually safe components whose only refuge is incompatible',()=>{
 const e=start([20,24]);assert.ok(e.state.comboSafe);
 const l=e.state.overdriveLayers[1];
 l.threats.push({shape:'disc',a:{x:580,y:399},b:{x:580,y:399},radius:5000,warning:0,active:4,end:4.1,velocity:{x:0,y:0}});
 assert.equal(certifyCombo(e.state,players(),0),undefined);
 let rewards=0,hits=0;e.update(.02,70,players(),()=>hits++,()=>rewards++);
 assert.equal(e.state.phase,'rest');assert.equal(e.state.overdriveLayers,undefined);assert.equal(rewards,0);assert.equal(hits,0);
});
test('a missing component cannot produce a successful certificate',()=>{
 const e=start([20,24]);e.state.overdriveLayers.pop();assert.equal(certifyCombo(e.state,players(),0),undefined);
});
test('Overdrive windows differ by mode, increase Survival pressure and do not change Daily',()=>{
 assert.equal(overdrivePhase('classic',59).intensity,0);assert.equal(overdrivePhase('classic',60).intensity,1);assert.equal(overdrivePhase('classic',78).intensity,0);
 assert.equal(overdrivePhase('blitz',25).intensity,2);assert.equal(overdrivePhase('chaos',20).intensity,3);
 assert.equal(overdrivePhase('survival',45).intensity,1);assert.equal(overdrivePhase('survival',165).intensity,2);assert.equal(overdrivePhase('survival',285).intensity,3);
 for(const time of [0,60,180,3600])assert.equal(overdrivePhase('daily',time).intensity,0);
 for(const [mode,before,during] of [['classic',59,60],['survival',44,45],['blitz',24,25],['chaos',19,20]]) {
  const rest=t=>{const e=new RuleEngine(rng(),mode);e.state.phase='active';e.state.ids=[10];e.state.remaining=0;e.update(.01,t,players(),()=>{},()=>{});return e.state.remaining;};
  assert.ok(rest(during)<rest(before));assert.ok(rest(during)>=.12);
 }
});
test('Overdrive staggers layers, keeps full reaction warning and limits total wave length',()=>{
 const e=start([20,24,22]),s=e.state;
 assert.equal(s.intensity,3);assert.equal(s.overdriveLayers.length,3);
 assert.equal(s.overdriveLayers[0].warning,2.8);assert.ok(s.overdriveLayers[1].warning>s.overdriveLayers[0].warning);
 assert.ok(s.overdriveLayers[2].warning>s.overdriveLayers[1].warning);
 assert.ok(s.overdriveLayers.every(l=>l.threats.every(h=>h.end<=s.duration)));
});
test('eight-player Online publishes all layers and phase, preserves reconnect and repeated Rematch',()=>{
 const r=new Room('ABC234',rng());for(let i=0;i<8;i++)r.join(`p${i}`,`token${i}`,`Player ${i}`,0);
 r.command('p0',{type:'mode',mode:'chaos'});
 for(let round=0;round<3;round++) {
  for(let i=0;i<8;i++)r.command(`p${i}`,{type:'ready',ready:true});r.command('p0',{type:'start'});for(let i=0;i<61;i++)r.tick(.05);
  r.time=70;r.rules.state.phase='announce';r.rules.state.ids=[20,24,22];r.rules.state.remaining=0;r.tick(.05);
  const s=JSON.parse(JSON.stringify(r.snapshot()));assert.equal(s.protocol,8);assert.equal(s.players.length,8);assert.equal(s.rules.intensity,3);assert.equal(s.rules.overdriveLayers.length,3);
  assert.deepEqual(s.rules.overdriveLayers,JSON.parse(JSON.stringify(r.rules.state.overdriveLayers)));
  r.disconnect('p0');assert.equal(r.join('new','new','Rejoined',0,'token0').id,'p0');assert.deepEqual(JSON.parse(JSON.stringify(r.snapshot())).rules.overdriveLayers,s.rules.overdriveLayers);
  for(const m of r.members.values())m.state.hp=0;r.tick(.05);assert.equal(r.phase,'results');assert.equal(r.rules.state.overdriveLayers,undefined);assert.equal(r.rules.state.intensity,0);
  r.command('p0',{type:'rematch'});assert.equal(r.time,0);assert.equal(r.rules.state.overdriveLayers,undefined);
 }
});
test('recent successful combinations are not chosen again in the next three successful combos',()=>{
 const e=new RuleEngine(rng(),'chaos'),seen=[];
 for(let i=0;i<50;i++) {
  e.state.phase='rest';e.state.remaining=0;e.update(.01,70,players(),()=>{},()=>{});
  const chosen=[...e.state.ids];e.state.phase='announce';e.state.remaining=0;e.update(.01,70,players(),()=>{},()=>{});
  if(e.state.comboSafe){const key=comboKey(chosen);assert.equal(seen.slice(-3).includes(key),false);seen.push(key);}
 }
 assert.ok(seen.length>=8);
});
test('triple safety generation, per-tick verification and snapshots have fixed budgets',()=>{
 let calls=0;const math=new Proxy(Math,{get:(target,key)=>key==='hypot'?(...args)=>{calls++;return Math.hypot(...args);}:Reflect.get(target,key)});
 const {RuleEngine:Measured}=loadModule('shared/ruleEngine',{Math:math}),e=new Measured(rng(),'chaos'),p=players();
 e.state.phase='announce';e.state.ids=[20,24,22];e.state.remaining=0;e.update(.01,70,p,()=>{},()=>{});
 assert.ok(e.state.comboSafe);assert.ok(calls<250000,`${calls} generation operations`);
 assert.equal(e.state.overdrive,undefined,'primary layer must not be duplicated in snapshots');
 assert.ok(JSON.stringify(e.state).length<14000);
 for(const time of [.05,3.6,5.6]) {
  calls=0;e.state.elapsed=time-.05;e.update(.05,70+time,p,()=>false,()=>{});
  assert.ok(calls<10000,`${calls} tick operations at ${time}`);
 }
});
test('joint renderer keeps common warnings and all layers on Low/Medium/High in RU/EN',()=>{
 const calls=[],g=new Proxy({}, {get:(_,method)=>(...args)=>{calls.push([method,...args]);return g;}});
 const locales=loadModule('locales/index'),effects=loadModule('effects');
 const {RuleView,ruleTitle,ruleSubtitle,ruleStatus}=loadModule('ruleView',{}, {phaser:{default:{}},'./locales':locales,'./effects':effects});
 const view=new RuleView({add:{graphics:()=>g,text:()=>g}}),s=start([20,24,22]).state;
 for(const language of ['ru','en']) {locales.setLocale(language);assert.ok(ruleTitle(s).includes(locales.t('overdrivePhase')));assert.equal(ruleSubtitle(s),locales.t('overdriveHint'));assert.ok(ruleStatus(s).includes(locales.t('overdriveWaves')));}
 for(const intensity of ['low','medium','high'])for(const elapsed of [.9,2.9,3.6,5]) {
  effects.setEffects(intensity);calls.length=0;s.elapsed=elapsed;view.draw(s);
  assert.ok(calls.some(c=>c[0]==='strokeCircle'),'common refuge remains visible');
  assert.ok(calls.some(c=>c[0]==='lineBetween'),'moving threat directions remain visible');
  assert.ok(calls.length<700,`${calls.length} graphics operations`);
 }
 s.phase='rest';calls.length=0;view.draw(s);assert.equal(calls.filter(c=>c[0]==='fillCircle'||c[0]==='lineBetween').length,0);
});
test('server abort does not count a survived event or grant combo score',()=>{
 const r=new Room('ABC234',rng());for(let i=0;i<8;i++)r.join(`p${i}`,`token${i}`,`Player ${i}`,0);
 for(let i=0;i<8;i++)r.command(`p${i}`,{type:'ready',ready:true});r.command('p0',{type:'start'});for(let i=0;i<61;i++)r.tick(.05);
 r.time=70;r.rules.state.phase='announce';r.rules.state.ids=[20,24];r.rules.state.remaining=0;r.tick(.05);
 const before=[...r.members.values()].map(m=>[m.scoring.rules,m.state.eventsSurvived??0]);
 r.rules.state.overdriveLayers[0].threats[0].radius=5000;r.tick(.05);
 assert.equal(r.rules.state.phase,'rest');assert.equal(r.rules.state.comboSafe,undefined);
 assert.deepEqual([...r.members.values()].map(m=>[m.scoring.rules,m.state.eventsSurvived??0]),before);
});
test('Online applies secondary-layer projectile collisions without trusting client claims',()=>{
 const r=new Room('ABC234',rng());for(let i=0;i<8;i++)r.join(`p${i}`,`token${i}`,`Player ${i}`,0);
 for(let i=0;i<8;i++)r.command(`p${i}`,{type:'ready',ready:true});r.command('p0',{type:'start'});for(let i=0;i<61;i++)r.tick(.05);
 r.time=70;r.rules.state.phase='announce';r.rules.state.ids=[20,24];r.rules.state.remaining=0;r.tick(.05);
 const bullet=r.rules.state.overdriveLayers[1].threats[0],b=r.members.get('p0').state;
 Object.assign(b,{x:58,y:bullet.a.y});r.rules.state.elapsed=2.65;r.tick(.05);assert.equal(b.hp,3);
 r.rules.state.elapsed=bullet.active;for(let i=0;i<3;i++)r.tick(.05);assert.ok(b.hp<3);
});
test('initial outward Dash at a contracting edge cannot receive a combined safety certificate',()=>{
 const p=players(),e=start([20,24],p,90);assert.ok(e.state.comboSafe);
 Object.assign(p[0],{x:46+90+15,y:399,vx:-920,vy:0,dashTime:.16,dashX:-1,dashY:0});
 assert.equal(certifyCombo(e.state,p,90),undefined);
});
test('Overdrive prefers compatible selections more often than the normal phase',()=>{
 const {seededRandom}=loadModule('shared/offlineProgress');
 const count=time=>{const e=new RuleEngine(seededRandom(42),'classic');let combos=0;
  for(let i=0;i<120;i++){e.state.phase='rest';e.state.remaining=0;e.update(.01,time,players(),()=>{},()=>{});if(e.state.ids.length>1)combos++;}
  return combos;
 };
 assert.ok(count(70)>count(80)*1.5);
});
