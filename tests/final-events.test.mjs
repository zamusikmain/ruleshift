import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load.mjs";
const { makeCrossfire,crossSegments,crossContact }=loadModule("shared/crossfire");
const { makeCollapse,collapseContact }=loadModule("shared/collapse");
const { makeSwarmTiles,updateSwarm,swarmTilesContact }=loadModule("shared/swarmTiles");
const { createBody,moveBody,damageBody }=loadModule("shared/movement");
const { RuleEngine,compatible }=loadModule("shared/ruleEngine");
const { Room }=loadModule("shared/room");
const { PROTOCOL_VERSION }=loadModule("shared/protocol");
const body=(id="p",x=580,y=399)=>({...createBody(x,y),id});
const players=()=>Array.from({length:8},(_,i)=>body(`p${i}`,580+130*Math.cos(i*Math.PI/4),399+100*Math.sin(i*Math.PI/4)));
const random=id=>({pick:v=>v.includes(id)?id:v[0],between:min=>min,shuffle:v=>v});
function move(p,q,dt) {
  const d=Math.hypot(q.x-p.x,q.y-p.y);
  if(d>2) moveBody(p,{x:(q.x-p.x)/d,y:(q.y-p.y)/d},dt);
  else {p.vx=0;p.vy=0;}
}

test("Crossfire covers four edges, intersecting fronts, stagger, geometry and swept collision",()=>{
  const l=makeCrossfire(players(),2,"chaos",0,0);assert.ok(l);
  assert.equal(new Set(l.attacks.map(a=>a.direction)).size,4);
  assert.equal(l.attacks[0].active,l.attacks[1].active);
  assert.ok(l.attacks[3].active>l.attacks[2].active);
  assert.ok(new Set(l.attacks.map(a=>a.speed)).size>1);
  assert.ok(new Set(l.attacks.map(a=>a.width)).size>1);
  for(const a of l.attacks) {
    const t=a.active+.2,line=crossSegments(a,t)[0];
    const p=body("p",(line.x1+line.x2)/2,(line.y1+line.y2)/2);
    assert.equal(crossContact({attacks:[a],phases:[]},p,a.active-.01),false);
    assert.equal(crossContact({attacks:[a],phases:[]},p,t),true);
    assert.equal(crossContact({attacks:[a],phases:[]},p,t+.04),false);
    assert.equal(crossContact({attacks:[a],phases:[]},p,t+.04,.08),true);
    assert.equal(crossContact({attacks:[a],phases:[]},p,a.end+.1),false);
  }
});

test("Crossfire: reachable changing openings remain safe through every tick for eight players",()=>{
  for(const mode of ["classic","survival","blitz","chaos","lastOneStanding"]) for(let rotation=0;rotation<4;rotation++) {
    const p=players(),l=makeCrossfire(p,2,mode,90,rotation);assert.ok(l);
    for(let t=0;t<6.5;t+=.01) p.forEach((b,i)=>{
      const previous={x:b.x,y:b.y};
      const phase=l.phases.find(phase=>t>=phase.warning&&t<=phase.end);
      if(phase && t>phase.warning+.3 && t<phase.active) move(b,phase.safe[i],.01);
      assert.equal(crossContact(l,b,t,.01,previous),false,`${mode}/${rotation}/${t}`);
    });
    assert.ok(l.phases.every(phase=>phase.end<6.5));
  }
  assert.equal(makeCrossfire(players(),2,"chaos",600,0),undefined);
});

test("Collapse: variants, permanent destruction, safe corridor and final island",()=>{
  const schedules=[];
  for(let variant=0;variant<3;variant++) {
    const p=players(),l=makeCollapse(p,90,variant);assert.ok(l);
    schedules.push(JSON.stringify(l.tiles));
    for(let t=0;t<5.2;t+=.01) p.forEach((b,i)=>{
      const previous={x:b.x,y:b.y};
      if(t>.3&&t<1.3) move(b,l.safe[i],.01);
      if(t>l.moveAt+.3&&t<l.finalAt) move(b,l.destination,.01);
      assert.equal(collapseContact(l,b,t,.01,previous),false,`${variant}/${i}/${t}`);
    });
    const tile=l.tiles.find(t=>t.active===1.3),b=body("p",tile.x+tile.width/2,tile.y+tile.height/2);
    assert.equal(collapseContact(l,b,1.29),false);
    assert.equal(collapseContact(l,b,1.31),true);
    assert.equal(collapseContact(l,b,5.1),true);
    assert.equal(collapseContact(l,b,5.3),false);
  }
  assert.equal(new Set(schedules).size,3);
  assert.equal(makeCollapse(players(),600,0),undefined);
});

for(const id of [16,17]) {
  const key=id===16?"crossfire":"collapse";
  test(`${key}: engine damage, completion, unsafe skip and no combinations`,()=>{
    const p=body(),engine=new RuleEngine(random(id));
    engine.state.phase="announce";engine.state.ids=[id];engine.state.remaining=0;
    engine.update(.01,70,[p],()=>damageBody(p),()=>{});
    const layout=engine.state[key];assert.ok(layout);
    if(id===16) {
      const line=crossSegments(layout.attacks[0],1.5)[0];Object.assign(p,{x:(line.x1+line.x2)/2,y:line.y1});
    } else {const t=layout.tiles.find(t=>t.active===1.3);Object.assign(p,{x:t.x+t.width/2,y:t.y+t.height/2});}
    for(let i=0;i<129;i++) engine.update(.01,70,[p],()=>damageBody(p),()=>{});
    assert.equal(p.hp,3);
    for(let i=0;i<30;i++) engine.update(.01,70,[p],()=>damageBody(p),()=>{});
    assert.ok(p.hp<3);
    Object.assign(p,id===16?layout.phases[1].safe[0]:layout.destination);
    while(engine.state.phase==="active") engine.update(.01,70,[p],()=>damageBody(p),()=>{});
    assert.equal(engine.state[key],undefined);
    engine.state.phase="announce";engine.state.ids=[id];engine.state.remaining=0;
    engine.update(.01,70,[{...p,radius:500}],()=>assert.fail("unsafe damage"),()=>assert.fail("unsafe reward"));
    assert.equal(engine.state.phase,"rest");
    for(let other=0;other<18;other++) assert.equal(compatible(id,other),false);
  });
  test(`${key}: eight-player authoritative snapshots, damage and three Rematches`,()=>{
    const room=new Room("ABC234",random(id));
    for(let i=0;i<8;i++) room.join(`p${i}`,`token${i}`,`Player ${i}`,0);
    for(let round=0;round<3;round++) {
      for(let i=0;i<8;i++) room.command(`p${i}`,{type:"ready",ready:true});
      room.command("p0",{type:"start"});
      for(let i=0;i<61;i++) room.tick(.05);
      room.rules.state.phase="announce";room.rules.state.ids=[id];room.rules.state.remaining=0;
      room.tick(.05);
      const l=room.rules.state[key],wire=JSON.parse(JSON.stringify(room.snapshot()));assert.ok(l);
      assert.equal(wire.protocol,PROTOCOL_VERSION);assert.equal(wire.players.length,8);
      assert.deepEqual(wire.rules[key],JSON.parse(JSON.stringify(l)));
      const victim=room.members.get("p0").state;
      if(id===16) {const line=crossSegments(l.attacks[0],1.5)[0];Object.assign(victim,{x:(line.x1+line.x2)/2,y:line.y1});}
      else {const t=l.tiles.find(t=>t.active===1.3);Object.assign(victim,{x:t.x+t.width/2,y:t.y+t.height/2});}
      for(let i=0;i<32;i++) room.tick(.05);assert.ok(victim.hp<3);
      for(const m of room.members.values()) m.state.hp=0;
      room.tick(.05);assert.equal(room.phase,"results");assert.equal(room.rules.state[key],undefined);
      assert.equal(room.command("p0",{type:"rematch"}),true);
    }
  });
}

test("Hunter Swarm orbits refuges instead of stopping at their boundaries",()=>{
  const p=body(),l=makeSwarmTiles("swarm",[p],2,"chaos",4,0,random(14));
  const q=l.safe[0];Object.assign(p,q);
  const h=l.hunters[0];h.x=q.x-45.01;h.y=q.y;
  let moved=0;
  for(let i=0;i<100;i++) {
    const before={x:h.x,y:h.y};updateSwarm(l,[p],new Map(),1.5+i*.02,.02);
    if(Math.hypot(h.x-before.x,h.y-before.y)>.1) moved++;
    assert.equal(swarmTilesContact(l,p,1.5+i*.02,.02),false);
  }
  assert.ok(moved>90);
});

test("Danger Tiles requires switching refuges; every cell activates and transitions are clear",()=>{
  for(let pattern=0;pattern<4;pattern++) {
    const rng={between:(min,max)=>min===0&&max===3?pattern:min};
    const l=makeSwarmTiles("tiles",players(),2,"chaos",4.5,90,rng);assert.ok(l);
    assert.equal(new Set(l.tiles.map(t=>`${t.x},${t.y}`)).size,24,"no permanent camping cell");
    assert.ok(l.phases[1].active-l.phases[0].end>=1.25-.001);
    const old=l.safe[0];
    assert.ok(l.tiles.some(t=>t.born===l.phases[1].warning&&swarmTilesContact({...l,tiles:[t]},body("p",old.x,old.y),t.active+.01,.01)));
  }
});

test("Final Collapse selection is reserved for late matches",()=>{
  for(const mode of ["classic","survival","blitz","chaos","lastOneStanding"]) {
    const selection={...random(17),between:(min,max)=>max===99?99:min};
    const early=new RuleEngine(selection,mode);early.state.remaining=0;
    early.update(.01,20,[body()],()=>{},()=>{});assert.notEqual(early.state.ids[0],17);
    const late=new RuleEngine(selection,mode);late.state.remaining=0;
    late.update(.01,mode==="blitz"?45:60,[body()],()=>{},()=>{});assert.equal(late.state.ids[0],17);
  }
});

test("final event rendering follows snapshots and RU/EN phases with a fixed drawing budget",()=>{
  const calls=[],g=new Proxy({}, {get:(_,method)=>(...args)=>{calls.push([method,...args]);return g;}});
  const locales=loadModule("locales/index");
  const { RuleView,ruleTitle,ruleSubtitle,ruleStatus }=loadModule("ruleView",{}, {phaser:{default:{}},"./locales":locales});
  const view=new RuleView({add:{graphics:()=>g,text:()=>g}});
  for(const id of [16,17]) {
    const e=new RuleEngine(random(id));e.state.phase="announce";e.state.ids=[id];e.state.remaining=0;
    e.update(.01,70,[body()],()=>{},()=>{});
    const s=JSON.parse(JSON.stringify(e.state));
    for(const locale of ["ru","en"]) {locales.setLocale(locale);assert.ok(ruleTitle(s));assert.ok(ruleSubtitle(s));assert.ok(ruleStatus(s));}
    s.elapsed=.8;calls.length=0;view.draw(s);assert.ok(calls.some(c=>c[0]==="strokeCircle"));
    s.elapsed=1.5;calls.length=0;view.draw(s);assert.ok(calls.some(c=>c[0]===(id===16?"lineBetween":"fillRect")));
    assert.ok(calls.length<300);
    s.phase="rest";calls.length=0;view.draw(s);assert.equal(calls.filter(c=>["lineBetween","fillRect"].includes(c[0])).length,0);
  }
});
