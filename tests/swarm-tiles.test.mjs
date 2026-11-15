import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load.mjs";
const { makeSwarmTiles,updateSwarm,swarmTilesContact,tileDistance }=loadModule("shared/swarmTiles");
const { createBody,moveBody,damageBody }=loadModule("shared/movement");
const { RuleEngine,compatible }=loadModule("shared/ruleEngine");
const { Room }=loadModule("shared/room");
const { PROTOCOL_VERSION,parseClientMessage }=loadModule("shared/protocol");
const body=(id="p",x=580,y=399)=>({...createBody(x,y),id});
const players=()=>Array.from({length:8},(_,i)=>body(`p${i}`,580+130*Math.cos(i*Math.PI/4),399+100*Math.sin(i*Math.PI/4)));
const random=(id,pattern=0)=>({pick:v=>v.includes(id)?id:v[0],between:(min,max)=>min===0&&max===3?pattern:min,shuffle:v=>v});

test("swarm tactics, target distribution, retarget on elimination and interception",()=>{
  const p=players(),l=makeSwarmTiles("swarm",p,2,"chaos",4,0,random(14));
  assert.ok(l);assert.equal(l.hunters.length,6);
  assert.equal(new Set(l.hunters.map(h=>h.model)).size,3);
  assert.equal(new Set(l.hunters.map(h=>h.target)).size,6);
  const before=JSON.stringify(l.hunters.map(h=>[h.x,h.y]));
  updateSwarm(l,p,new Map(),1,.05);
  assert.equal(JSON.stringify(l.hunters.map(h=>[h.x,h.y])),before);
  const dead=l.hunters[0].target;p.find(p=>p.id===dead).hp=0;
  updateSwarm(l,p,new Map(p.map(p=>[p.id,{x:p.x-10,y:p.y}])),1.5,.05);
  assert.ok(l.hunters.every(h=>h.target!==dead));
  assert.notEqual(JSON.stringify(l.hunters.map(h=>[h.x,h.y])),before);
  const loads=p.filter(p=>p.hp>0).map(p=>l.hunters.filter(h=>h.target===p.id).length);
  assert.ok(Math.max(...loads)-Math.min(...loads)<=1);
  // Controlled geometry distinguishes prediction from direct pursuit.
  const hunter={x:100,y:200,previous:{x:100,y:200},radius:12,speed:100,target:"p",patrol:{x:100,y:300}};
  const target=body("p",200,200),old=new Map([["p",{x:200,y:190}]]);
  const direct={...l,safe:[],hunters:[{...hunter,model:"chase"}]};
  const intercept={...l,safe:[],hunters:[{...hunter,model:"intercept"}]};
  updateSwarm(direct,[target],old,1.5,.05);updateSwarm(intercept,[target],old,1.5,.05);
  assert.equal(direct.hunters[0].y,200);assert.ok(intercept.hunters[0].y>200);
  const patrol={...l,safe:[],hunters:[{...hunter,model:"patrol"}]};
  const far=body("p",600,200);
  updateSwarm(patrol,[far],new Map(),1.5,.05);assert.ok(patrol.hunters[0].y>200);
  const y=patrol.hunters[0].y;
  updateSwarm(patrol,[far],new Map(),3,.05);assert.ok(patrol.hunters[0].x>100);assert.ok(patrol.hunters[0].y<y);
});

test("swarm relative swept collision detects a fast crossing and excludes warning",()=>{
  const l=makeSwarmTiles("swarm",players(),0,"classic",6,0,random(14));
  l.hunters=[{...l.hunters[0],previous:{x:100,y:100},x:200,y:100}];
  const p=body("p",150,100);
  assert.equal(swarmTilesContact(l,p,1,.05),false);
  assert.equal(swarmTilesContact(l,p,1.5,.05),true);
  assert.equal(swarmTilesContact(l,body("p",150,140),1.5,.05),false);
});

test("tiles rectangle edges, warning, fast crossing and return to safety",()=>{
  const tile={x:100,y:100,width:30,height:40,born:0,active:1.25,end:1.55};
  const l={kind:"tiles",tiles:[tile],hunters:[],safe:[],warning:1.25};
  assert.equal(tileDistance({x:133,y:144},tile),5);
  assert.equal(swarmTilesContact(l,body("p",115,120),1.24,.01),false);
  assert.equal(swarmTilesContact(l,body("p",115,120),1.3,.01),true);
  assert.equal(swarmTilesContact(l,body("p",115,120),1.6,.01),false);
  assert.equal(swarmTilesContact(l,body("p",160,120),1.4,.05,{x:70,y:120}),true);
});

for(const kind of ["swarm","tiles"]) {
  const id=kind==="swarm"?14:15;
  test(`${kind}: full-event reachable safety for eight players and all modes`,()=>{
    for(const mode of ["classic","survival","blitz","chaos","lastOneStanding"]) {
      const duration=kind==="tiles"?4.5:3.25;
      const p=players(),l=makeSwarmTiles(kind,p,2,mode,duration,90,random(id));assert.ok(l,mode);
      p.forEach((p,i)=>{
        const q=l.safe[i];let time=.3;
        while(time<l.warning-.05 && Math.hypot(q.x-p.x,q.y-p.y)>3) {
          const d=Math.hypot(q.x-p.x,q.y-p.y);moveBody(p,{x:(q.x-p.x)/d,y:(q.y-p.y)/d},.01);time+=.01;
        }
        assert.ok(Math.hypot(q.x-p.x,q.y-p.y)<4);
      });
      for(let time=0;time<duration;time+=.05) {
        if(kind==="tiles" && time>l.phases[0].end+.3 && time<l.phases[1].active) p.forEach((b,i)=>{
          const q=l.phases[1].safe[i],d=Math.hypot(q.x-b.x,q.y-b.y);
          if(d>3) moveBody(b,{x:(q.x-b.x)/d,y:(q.y-b.y)/d},.05);
          else {b.vx=0;b.vy=0;}
        });
        updateSwarm(l,p,new Map(),time,.05);
        for(const b of p) assert.equal(swarmTilesContact(l,b,time,.05),false);
        for(const h of l.hunters) for(const q of l.safe) assert.ok(Math.hypot(h.x-q.x,h.y-q.y)>=l.refugeRadius+h.radius);
      }
    }
    assert.equal(makeSwarmTiles(kind,players(),2,"chaos",4,600,random(id)),undefined);
    assert.equal(makeSwarmTiles(kind,[{...body(),radius:500}],2,"chaos",4,0,random(id)),undefined);
  });
  test(`${kind}: authoritative engine damage, warning, finish and unsafe skip`,()=>{
    const p=body(),e=new RuleEngine(random(id),"blitz");let rewards=0;
    e.state.phase="announce";e.state.ids=[id];e.state.remaining=0;
    const step=()=>e.update(.01,35,[p],()=>damageBody(p),()=>rewards++);
    while(e.state.phase!=="active") step();
    const l=e.state.swarmTiles;assert.ok(l);
    for(let i=0;i<120;i++) step();assert.equal(p.hp,3);
    if(kind==="swarm") Object.assign(p,{x:l.hunters[0].x,y:l.hunters[0].y});
    else {const t=l.tiles.find(t=>t.active===l.warning);Object.assign(p,{x:t.x+t.width/2,y:t.y+t.height/2});}
    for(let i=0;i<10;i++) step();assert.equal(p.hp,2);assert.equal(p.damageTaken,1);
    Object.assign(p,l.safe[0]);while(e.state.phase==="active") step();
    assert.equal(e.state.swarmTiles,undefined);assert.equal(rewards,0);
    e.state.phase="announce";e.state.ids=[id];e.state.remaining=0;
    e.update(.01,0,[{...p,radius:500}],()=>assert.fail("unsafe damage"),()=>assert.fail("unsafe reward"));
    assert.equal(e.state.phase,"rest");
    for(let other=0;other<16;other++) assert.equal(compatible(id,other),false);
  });
  test(`${kind}: eight-player snapshots and three server Rematches`,()=>{
    const room=new Room("ABC234",random(id));
    for(let i=0;i<8;i++) room.join(`p${i}`,`session${i}`,`Player ${i}`,0);
    for(let round=0;round<3;round++) {
      for(let i=0;i<8;i++) room.command(`p${i}`,{type:"ready",ready:true});
      assert.equal(room.command("p0",{type:"start"}),true);
      for(let i=0;i<300 && !room.rules.state.swarmTiles;i++) room.tick(.05);
      const wire=JSON.parse(JSON.stringify(room.snapshot())),l=room.rules.state.swarmTiles;
      assert.equal(wire.players.length,8);assert.equal(wire.protocol,PROTOCOL_VERSION);
      assert.deepEqual(wire.rules.swarmTiles,JSON.parse(JSON.stringify(l)));
      const victim=room.members.get("p0").state;
      for(let i=0;i<24;i++) room.tick(.05);
      if(kind==="swarm") Object.assign(victim,{x:l.hunters[0].x,y:l.hunters[0].y});
      else {const t=l.tiles[0];Object.assign(victim,{x:t.x+t.width/2,y:t.y+t.height/2});}
      for(let i=0;i<3;i++) room.tick(.05);assert.ok(victim.hp<3);
      for(const m of room.members.values()) m.state.hp=0;
      room.tick(.05);assert.equal(room.phase,"results");assert.equal(room.rules.state.swarmTiles,undefined);
      assert.equal(room.command("p0",{type:"rematch"}),true);
    }
    assert.equal(parseClientMessage(JSON.stringify({type:"input",x:0,y:0,swarmTiles:{}})),null);
  });
}

test("all four tile patterns leave safe tiles in every phase and difficulty increases tempo",()=>{
  const schedules=[];
  for(let pattern=0;pattern<4;pattern++) {
    const l=makeSwarmTiles("tiles",players(),2,"chaos",4.5,0,random(15,pattern));assert.ok(l);
    assert.equal(l.pattern,["stripes","checker","waves","random"][pattern]);
    schedules.push(JSON.stringify(l.tiles));
    for(const phase of l.phases) for(const t of l.tiles.filter(t=>t.born===phase.warning)) {assert.ok(t.end<=4.5);for(const q of phase.safe) assert.ok(tileDistance(q,t)>26);}
    for(const time of new Set(l.tiles.map(t=>t.active))) assert.ok(l.tiles.filter(t=>t.active===time).length<24);
  }
  assert.equal(new Set(schedules).size,4);
  const low=makeSwarmTiles("swarm",players(),0,"classic",6,0,random(14));
  const high=makeSwarmTiles("swarm",players(),2,"chaos",4,0,random(14));
  assert.ok(high.hunters.length>low.hunters.length);assert.ok(high.hunters[0].speed>low.hunters[0].speed);
  assert.ok(high.aggression>low.aggression);
  const sparse=makeSwarmTiles("tiles",players(),0,"classic",6,0,random(15));
  const dense=makeSwarmTiles("tiles",players(),2,"chaos",4.5,0,random(15));
  assert.ok(dense.tiles[0].end-dense.tiles[0].active>sparse.tiles[0].end-sparse.tiles[0].active);
  assert.ok(dense.phases[0].end-dense.phases[0].active>sparse.phases[0].end-sparse.phases[0].active);
});

test("swarm and tile rendering uses snapshots, localized phases and bounded graphics calls",()=>{
  const calls=[],g=new Proxy({}, {get:(_,method)=>(...args)=>{calls.push([method,...args]);return g;}});
  const locales=loadModule("locales/index");
  const { RuleView,ruleTitle,ruleSubtitle,ruleStatus }=loadModule("ruleView",{}, {phaser:{default:{}},"./locales":locales});
  const view=new RuleView({add:{graphics:()=>g,text:()=>g}});
  for(const kind of ["swarm","tiles"]) {
    const id=kind==="swarm"?14:15,e=new RuleEngine(random(id));
    while(e.state.phase!=="active") e.update(.01,0,[body()],()=>{},()=>{});
    const s=JSON.parse(JSON.stringify(e.state));
    for(const locale of ["ru","en"]) {locales.setLocale(locale);assert.ok(ruleTitle(s));assert.ok(ruleSubtitle(s));assert.ok(ruleStatus(s));}
    s.elapsed=.8;calls.length=0;view.draw(s);
    assert.ok(calls.some(c=>c[0]==="strokeCircle"));
    s.elapsed=1.3;calls.length=0;view.draw(s);
    assert.ok(calls.some(c=>c[0]===(kind==="swarm"?"fillCircle":"fillRect")));
    assert.ok(calls.length<200);
    s.phase="rest";calls.length=0;view.draw(s);
    assert.equal(calls.filter(c=>["fillCircle","fillRect"].includes(c[0])).length,0);
  }
});
