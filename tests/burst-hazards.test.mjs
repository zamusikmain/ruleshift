import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load.mjs";
const { makeBurstLayout, burstContact, burstRefuge, waveRadius, waveDistance }=loadModule("shared/burstHazards");
const { createBody,moveBody,damageBody }=loadModule("shared/movement");
const { RuleEngine,compatible }=loadModule("shared/ruleEngine");
const { SAFE_PAIRS }=loadModule("shared/comboSafety");
const { Room }=loadModule("shared/room");
const { PROTOCOL_VERSION,parseClientMessage }=loadModule("shared/protocol");
const random=id=>({pick:v=>v.includes(id)?id:v[0],between:min=>min,shuffle:v=>v});
const body=(x=580,y=399)=>({...createBody(x,y),id:"p"});
const players=()=>Array.from({length:8},(_,i)=>body(580+130*Math.cos(i*Math.PI/4),399+100*Math.sin(i*Math.PI/4)));

test("Meteor Madness has varied falls, increasing waves and delayed secondary explosions",()=>{
  const l=makeBurstLayout("madness",players(),2,"chaos",4,0,random(12));
  assert.ok(l);
  const primary=l.explosions.filter(e=>!e.secondary);
  assert.equal(new Set(primary.map(e=>e.impact)).size,5);
  assert.ok(new Set(primary.map(e=>e.radius)).size>1);
  assert.ok(new Set(primary.map(e=>e.impact-e.born)).size>1);
  const e=primary[0],p=body(e.x,e.y);
  assert.equal(burstContact(l,p,e.impact-.001),false);
  assert.equal(burstContact(l,p,e.impact),true);
  const secondary=l.explosions.find(e=>e.secondary);
  assert.ok(secondary.impact>e.impact);
  const isolated={...l,explosions:[secondary]};
  assert.equal(burstContact(isolated,body(secondary.x,secondary.y),secondary.impact-.001),false);
  assert.equal(burstContact(isolated,body(secondary.x,secondary.y),secondary.impact),true);
  // A blast born and expired within one delayed tick still hits.
  assert.equal(burstContact(isolated,body(secondary.x,secondary.y),secondary.impact+.3,.4),true);
  assert.equal(burstContact(isolated,p,secondary.impact+.3),false);
});

test("Shockwave geometry respects gaps, endpoints, wave expiry and swept fronts",()=>{
  const w={x:580,y:399,born:0,impact:1.35,speed:1000,inner:40,outer:350,width:8,gap:0,halfGap:Math.PI/3};
  const l={kind:"shockwave",warning:1.35,waves:[w],explosions:[],safe:[]};
  const p=body(380,399);
  assert.equal(waveRadius(w,1.35),40);
  assert.equal(waveDistance(w,body(780,399),200)>20,true);
  assert.equal(burstContact(l,p,1.349),false);
  assert.equal(burstContact(l,p,1.45),false);
  assert.equal(burstContact(l,p,1.59),false);
  assert.equal(burstContact(l,p,1.59,.14),true);
  assert.equal(burstContact(l,body(780,399),1.59,.14),false);
  const edge=body(580+200*Math.cos(w.halfGap),399+200*Math.sin(w.halfGap));
  assert.equal(burstContact(l,edge,1.51),true);
  assert.equal(burstContact(l,p,2),false);
  assert.equal(burstContact(l,body(280,399),1.51,.05,{x:480,y:399}),true);
});

for(const kind of ["madness","shockwave"]) {
  const id=kind==="madness"?12:13;
  test(`${kind}: reachable whole-event refuges for eight players, modes and contraction`,()=>{
    for(const mode of ["classic","survival","blitz","chaos","lastOneStanding"]) {
      const bodies=players(),l=makeBurstLayout(kind,bodies,2,mode,3.25,50,random(id));
      assert.ok(l,mode);
      assert.equal(l.safe.length,8);
      bodies.forEach((p,i)=>{
        const q=l.safe[i];
        let time=.3;
        while(time<l.warning-.05 && Math.hypot(q.x-p.x,q.y-p.y)>3) {
          const d=Math.hypot(q.x-p.x,q.y-p.y);
          moveBody(p,{x:(q.x-p.x)/d,y:(q.y-p.y)/d},.01);time+=.01;
        }
        assert.ok(Math.hypot(q.x-p.x,q.y-p.y)<4);
        for(let t=0;t<3.3;t+=.05) assert.equal(burstContact(l,p,t,.05),false,`${mode}: ${i} at ${t}`);
      });
    }
    assert.equal(makeBurstLayout(kind,[{...body(),radius:500}],2,"chaos",4,0,random(id)),undefined);
    assert.equal(makeBurstLayout(kind,players(),2,"chaos",4,600,random(id)),undefined);
    assert.equal(makeBurstLayout(kind,[],0,"classic",4,0,random(id)),undefined);
  });
  test(`${kind}: engine warning, damage, immunity, completion and unsafe skip`,()=>{
    const p=body(),engine=new RuleEngine(random(id),"blitz");
    engine.state.phase="announce";engine.state.ids=[id];engine.state.remaining=0;
    let rewards=0;
    const step=()=>engine.update(.01,35,[p],()=>damageBody(p),()=>rewards++);
    while(engine.state.phase!=="active") step();
    const l=engine.state.burstLayout;
    assert.ok(l);
    Object.assign(p,kind==="madness"?{x:l.explosions[0].x,y:l.explosions[0].y}:{x:540,y:399});
    for(let i=0;i<130;i++) step();
    assert.equal(p.hp,3);
    for(let i=0;i<10;i++) step();
    assert.equal(p.hp,2);
    assert.equal(p.damageTaken,1);
    Object.assign(p,l.safe[0]);
    while(engine.state.phase==="active") step();
    assert.equal(engine.state.burstLayout,undefined);
    assert.equal(rewards,0);
    for(let other=0;other<18;other++) assert.equal(compatible(id,other),SAFE_PAIRS.some(c=>c.includes(id)&&c.includes(other)&&id!==other));
    engine.state.phase="announce";engine.state.ids=[id];engine.state.remaining=0;
    engine.update(.01,0,[{...p,radius:500}],()=>assert.fail("unsafe damage"),()=>assert.fail("unsafe reward"));
    assert.equal(engine.state.phase,"rest");
    assert.equal(engine.state.burstLayout,undefined);
  });
  test(`${kind}: eight-player server damage, snapshots and three Rematches`,()=>{
    const room=new Room("ABC234",random(id));
    for(let i=0;i<8;i++) room.join(`p${i}`,`session${i}`,`Player ${i}`,0);
    room.command("p0",{type:"mode",mode:"chaos"});
    for(let round=0;round<3;round++) {
      for(let i=0;i<8;i++) room.command(`p${i}`,{type:"ready",ready:true});
      assert.equal(room.command("p0",{type:"start"}),true);
      for(let i=0;i<300 && !room.rules.state.burstLayout;i++) room.tick(.05);
      const wire=JSON.parse(JSON.stringify(room.snapshot())),l=room.rules.state.burstLayout;
      assert.equal(wire.protocol,PROTOCOL_VERSION);
      assert.equal(wire.players.length,8);
      assert.deepEqual(wire.rules.burstLayout,JSON.parse(JSON.stringify(l)));
      const victim=room.members.get("p0").state;
      Object.assign(victim,kind==="madness"?{x:l.explosions[0].x,y:l.explosions[0].y}:{x:540,y:399});
      for(let i=0;i<Math.ceil((l.warning+.3)/.05);i++) room.tick(.05);
      assert.ok(victim.hp<3);
      for(const m of room.members.values()) m.state.hp=0;
      room.tick(.05);
      assert.equal(room.phase,"results");
      assert.equal(room.rules.state.burstLayout,undefined);
      assert.equal(room.command("p0",{type:"rematch"}),true);
    }
    assert.equal(parseClientMessage(JSON.stringify({type:"input",x:0,y:0,burstLayout:{}})),null);
  });
}

test("shockwave difficulty changes speed and count; overlapping explosions retain a refuge",()=>{
  const low=makeBurstLayout("shockwave",players(),0,"classic",4,0,random(13));
  const high=makeBurstLayout("shockwave",players(),2,"chaos",4,0,random(13));
  assert.ok(high.waves.length>low.waves.length);
  assert.ok(high.waves[0].speed>low.waves[0].speed);
  const l=makeBurstLayout("madness",players(),2,"chaos",4,0,random(12));
  assert.ok(burstRefuge(l,body(l.explosions[0].x,l.explosions[0].y),0));
});

test("seeded scattered schedules preserve a reachable refuge through primary and secondary overlaps",()=>{
  for(let seed=1;seed<=20;seed++) {
    let value=seed;
    const rng={between:(min,max)=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return min+value%(max-min+1);}};
    for(const kind of ["madness","shockwave"]) {
      const bodies=players(),l=makeBurstLayout(kind,bodies,2,"chaos",4,90,rng);
      // A rejected schedule is valid; accepted schedules must pass all invariants.
      if(!l) continue;
      assert.equal(l.safe.length,8);
      for(const q of l.safe) {
        assert.ok(q.x>46+90 && q.x<1114-90 && q.y>144+54 && q.y<654-54);
        for(let t=0;t<4.1;t+=.025) assert.equal(burstContact(l,{...body(),...q},t,.025),false);
      }
      for(const e of l.explosions) assert.ok(e.impact+e.duration<=4);
      for(const w of l.waves) assert.ok(w.impact+(w.outer-w.inner)/w.speed<=4);
    }
  }
});

test("burst renderer draws warning/impact/front phases from snapshots and clears on completion in RU/EN",()=>{
  const calls=[],g=new Proxy({}, {get:(_,method)=>(...args)=>{calls.push([method,...args]);return g;}});
  const locales=loadModule("locales/index");
  const { RuleView,ruleTitle,ruleSubtitle,ruleStatus }=loadModule("ruleView",{}, {phaser:{default:{}},"./locales":locales});
  const view=new RuleView({add:{graphics:()=>g,text:()=>g}});
  for(const kind of ["madness","shockwave"]) {
    const engine=new RuleEngine(random(kind==="madness"?12:13));
    while(engine.state.phase!=="active") engine.update(.01,0,[body()],()=>{},()=>{});
    const s=JSON.parse(JSON.stringify(engine.state));
    for(const lang of ["ru","en"]) {
      locales.setLocale(lang);
      assert.ok(ruleTitle(s));assert.ok(ruleSubtitle(s));assert.ok(ruleStatus(s));
    }
    s.elapsed=.7;calls.length=0;view.draw(s);
    assert.ok(calls.some(c=>c[0]==="strokeCircle"));
    s.elapsed=1.36;calls.length=0;view.draw(s);
    assert.ok(calls.some(c=>c[0]===(kind==="madness"?"fillCircle":"arc")));
    assert.ok(calls.length<200,"bounded graphics work without particles");
    s.elapsed=10;calls.length=0;view.draw(s);
    assert.equal(calls.filter(c=>["arc","fillCircle","strokeCircle"].includes(c[0])).length,0);
    s.phase="rest";calls.length=0;view.draw(s);
    assert.equal(calls.filter(c=>c[0]==="arc").length,0);
  }
});
