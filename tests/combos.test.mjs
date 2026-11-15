import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load.mjs";
const { RuleEngine }=loadModule("shared/ruleEngine");
const { SAFE_PAIRS,SAFE_TRIPLES,certifyCombo,jointlySafe,comboWarning }=loadModule("shared/comboSafety");
const { createBody,moveBody }=loadModule("shared/movement");
const { laserContact }=loadModule("shared/laserHazards");
const { burstContact }=loadModule("shared/burstHazards");
const { Room }=loadModule("shared/room");
const { PROTOCOL_VERSION }=loadModule("shared/protocol");
const players=()=>Array.from({length:8},(_,i)=>({...createBody(580+130*Math.cos(i*Math.PI/4),399+100*Math.sin(i*Math.PI/4)),id:`p${i}`}));
const rng={pick:v=>v[0],between:min=>min,shuffle:v=>v};
function start(ids,p=players(),inset=0) {
  const e=new RuleEngine(rng,"chaos");e.state.phase="announce";e.state.ids=[...ids];e.state.remaining=0;
  e.update(.01,70,p,()=>{},()=>{},()=>{},()=>{},1,inset);return e;
}

for(const ids of [...SAFE_PAIRS,...SAFE_TRIPLES]) test(`combo ${ids.join("+")}: eight players have a safe route and invariant refuge for every tick`,()=>{
  const p=players(),e=start(ids,p),s=e.state;
  assert.equal(s.ids.length,ids.length,"candidate must actually run");
  assert.equal(s.comboSafe.length,8);
  const warning=comboWarning(s);
  for(let time=0;time<s.duration;time+=.02) p.forEach((b,i)=>{
    const previous={x:b.x,y:b.y},q=s.comboSafe[i],distance=Math.hypot(q.x-b.x,q.y-b.y);
    if(time>.3&&time<warning&&distance>2) moveBody(b,{x:(q.x-b.x)/distance,y:(q.y-b.y)/distance},.02);
    else {b.vx=0;b.vy=0;}
    if(s.laserLayout) assert.equal(laserContact(s.laserLayout,b,time,.02,previous),false);
    if(s.burstLayout) assert.equal(burstContact(s.burstLayout,b,time,.02,previous),false);
    if(time>=2) for(const h of s.hazards) assert.ok(Math.hypot(b.x-h.x,b.y-h.y)>h.radius+b.radius);
  });
  assert.ok(s.comboSafe.every((q,i)=>jointlySafe(s,q,p[i].radius)));
  assert.ok(p.every((b,i)=>Math.hypot(b.x-s.comboSafe[i].x,b.y-s.comboSafe[i].y)<3),"ordinary acceleration reaches each certified destination");
  assert.ok(certifyCombo(s,players(),90),"contraction reserve");
});

test("unsafe union falls back to a singleton; unsupported moving pairs cannot run",()=>{
  const p=players(),e=start([10,12],p);
  assert.ok(e.state.comboSafe);
  e.state.laserLayout.width=2000;
  assert.equal(certifyCombo(e.state,p,0),undefined);
  const unsupported=start([5,8],p);
  assert.equal(unsupported.state.ids.length,1);
  assert.equal(unsupported.state.comboSafe,undefined);
  const cramped=start([10,12],p,600);
  assert.ok(cramped.state.ids.length<=1);
});

test("server publishes the same combo certificate and resets it through Rematch",()=>{
  const room=new Room("ABC234",rng);
  for(let i=0;i<8;i++) room.join(`p${i}`,`secret${i}`,`Player ${i}`,0);
  room.command("p0",{type:"mode",mode:"chaos"});
  for(let round=0;round<3;round++) {
    for(let i=0;i<8;i++) room.command(`p${i}`,{type:"ready",ready:true});
    room.command("p0",{type:"start"});for(let i=0;i<61;i++) room.tick(.05);
    room.rules.state.phase="announce";room.rules.state.ids=[1,10,12];room.rules.state.remaining=0;
    room.tick(.05);
    const s=JSON.parse(JSON.stringify(room.snapshot()));
    assert.equal(s.protocol,PROTOCOL_VERSION);assert.equal(PROTOCOL_VERSION,8);
    assert.equal(s.rules.ids.length,3);assert.equal(s.rules.comboSafe.length,8);
    assert.deepEqual(s.rules.comboSafe,JSON.parse(JSON.stringify(room.rules.state.comboSafe)));
    for(const m of room.members.values()) m.state.hp=0;
    room.tick(.05);room.command("p0",{type:"rematch"});
  }
});

test("mode tempo starts hazards inside ten seconds and accelerates rest without shortening warning",()=>{
  const { modeRules }=loadModule("shared/modes");
  assert.ok(modeRules("blitz").rest<modeRules("classic").rest);
  assert.ok(modeRules("chaos").rest<modeRules("survival").rest);
  for(const mode of ["classic","survival","blitz","chaos"]) {
    assert.ok(modeRules(mode).rest+modeRules(mode).announce+1.35<10);
    const e=new RuleEngine(rng,mode),p=players();
    e.state.phase="active";e.state.ids=[10];e.state.remaining=0;
    e.update(.01,0,p,()=>{},()=>{});const early=e.state.remaining;
    e.state.phase="active";e.state.remaining=0;
    e.update(.01,120,p,()=>{},()=>{});assert.ok(e.state.remaining<early);
  }
});

test("effects preferences persist, tolerate corrupt storage and low mode preserves damage feedback",()=>{
  const storage=new Map(),calls=[];
  const effects=loadModule("effects",{localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
  effects.setEffects("low");assert.equal(storage.get("ruleshift.effects.v1"),"low");
  const scene={cameras:{main:{shake:()=>calls.push("shake"),flash:()=>calls.push("flash")}}};
  effects.damageEffects(scene);assert.deepEqual(calls,["flash"]);
  effects.setEffects("high");effects.damageEffects(scene);assert.deepEqual(calls,["flash","shake","flash"]);
  assert.equal(effects.validEffects("broken"),false);
});

test("combo renderer has bounded work; low intensity removes glow but keeps warnings",()=>{
  const counts=[],g=new Proxy({}, {get:(_,method)=>(...args)=>{counts.push(method);return g;}});
  const effects=loadModule("effects"),{ RuleView }=loadModule("ruleView",{}, {phaser:{default:{}},"./effects":effects});
  const view=new RuleView({add:{graphics:()=>g,text:()=>g}}),s=start([1,10,12]).state;
  s.elapsed=.9;effects.setEffects("high");view.draw(s);const high=counts.length;
  counts.length=0;effects.setEffects("low");view.draw(s);
  assert.ok(counts.includes("strokeCircle"));assert.ok(counts.includes("lineBetween"));assert.ok(counts.length<high);assert.ok(high<400);
});

test("combo certificates tolerate reaction drift, active Dash and reversal without needing a second Dash",()=>{
  for(const ids of [...SAFE_PAIRS,...SAFE_TRIPLES]) {
    const p=players(),s=start(ids,p).state;assert.equal(s.ids.length,ids.length);
    p.forEach((b,i)=>{
      const q=s.comboSafe[i],d=Math.hypot(q.x-b.x,q.y-b.y)||1;
      b.dashTime=.16;b.dashX=-(q.x-b.x)/d;b.dashY=-(q.y-b.y)/d;b.speedTime=.3;
    });
    for(let t=0;t<2;t+=.01) p.forEach((b,i)=>{
      const q=s.comboSafe[i],d=Math.hypot(q.x-b.x,q.y-b.y);
      if(t<.3) moveBody(b,{x:b.dashX,y:b.dashY},.01);
      else if(d>2) moveBody(b,{x:(q.x-b.x)/d,y:(q.y-b.y)/d},.01);
      else {b.vx=0;b.vy=0;}
    });
    p.forEach((b,i)=>assert.ok(Math.hypot(b.x-s.comboSafe[i].x,b.y-s.comboSafe[i].y)<3,ids.join("+")));
  }
});

test("joint safety search stays inside a fixed geometry work budget",()=>{
  let calls=0;
  const math=new Proxy(Math,{get:(target,key)=>key==="hypot"?(...args)=>{calls++;return Math.hypot(...args);}:Reflect.get(target,key)});
  const { certifyCombo: measured }=loadModule("shared/comboSafety",{Math:math});
  const s=start([1,10,12]).state;
  assert.ok(measured(s,players(),0));assert.ok(calls<150000,`${calls} distance calculations`);
});

test("Chaos prioritizes combo candidates and recent primary hazards do not repeat",()=>{
  const e=new RuleEngine(rng,"chaos"),history=[];let combos=0;
  for(let i=0;i<12;i++) {
    e.state.phase="rest";e.state.remaining=0;
    e.update(.01,70,players(),()=>{},()=>{});
    if(e.state.ids.length>=2) combos++;
    assert.equal(history.slice(-4).includes(e.state.ids[0]),false);
    history.push(e.state.ids[0]);
  }
  assert.ok(combos>=6,"combos are frequent without sacrificing sequence diversity");
});
