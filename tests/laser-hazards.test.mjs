import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load.mjs";
const { makeLaserLayout, laserLines, laserContact, lineDistance, reachableSafe } = loadModule("shared/laserHazards");
const { createBody, moveBody, damageBody } = loadModule("shared/movement");
const { RuleEngine, compatible } = loadModule("shared/ruleEngine");
const { SAFE_PAIRS } = loadModule("shared/comboSafety");
const { Room } = loadModule("shared/room");
const { PROTOCOL_VERSION, parseClientMessage } = loadModule("shared/protocol");
const random = id => ({ pick: v => v.includes(id) ? id : v[0], between: min => min, shuffle: v => v });
const player = (x=580,y=399) => ({...createBody(x,y),id:"p"});

test("laser segment geometry includes finite endpoints and body radius", () => {
  const l={x1:0,y1:0,x2:10,y2:0};
  assert.equal(lineDistance({x:5,y:3},l),3);
  assert.equal(lineDistance({x:14,y:3},l),5);
  const layout=makeLaserLayout("grid",[player()],0,"classic");
  const p=player(layout.lines[0].x1,399);
  assert.equal(laserContact(layout,p,layout.warning-.001),false);
  assert.equal(laserContact(layout,p,layout.warning),true);
  p.x+=p.radius+layout.width/2+1;
  p.y=180;
  assert.equal(laserContact(layout,p,layout.warning),false);
});

test("Death Spin rotates, leaves permanent refuge and detects swept beams", () => {
  const l=makeLaserLayout("spin",[player()],2,"chaos");
  const a=laserLines(l,l.warning),b=laserLines(l,l.warning+1);
  assert.notEqual(a[0].x2,b[0].x2);
  assert.equal(laserContact(l,player(),l.warning+1,1),false);
  assert.equal(laserContact(l,player(850,399),l.warning+1,1),false);
  const angle=l.speed*.5;
  const p=player(580+160*Math.cos(angle),399+160*Math.sin(angle));
  assert.equal(laserContact(l,p,l.warning),false);
  assert.equal(laserContact(l,p,l.warning+1),false);
  assert.equal(laserContact(l,p,l.warning+1,1),true);
});

test("fast moving players cannot tunnel across a grid between server ticks", () => {
  const l=makeLaserLayout("grid",[player()],0,"classic");
  const x=l.lines[0].x1;
  const p=player(x+24,180);
  assert.equal(laserContact(l,p,l.warning+.1),false);
  assert.equal(laserContact(l,p,l.warning+.1,.05,{x:x-24,y:180}),true);
  assert.equal(laserContact(l,p,l.warning-.1,.05,{x:x-24,y:180}),false);
});

for (const kind of ["grid","spin"]) {
  test(`${kind}: safe destinations are reachable by eight ordinary moving bodies in every mode`, () => {
    for (const mode of ["classic","survival","blitz","chaos","lastOneStanding"]) {
      const bodies=Array.from({length:8},(_,i)=>player(580+150*Math.cos(i*Math.PI/4),399+100*Math.sin(i*Math.PI/4)));
      const l=makeLaserLayout(kind,bodies,2,mode,25);
      assert.ok(l,mode);
      assert.equal(l.safe.length,8);
      bodies.forEach((p,i)=>{
        const q=l.safe[i];
        assert.equal(laserContact(l,{...p,...q},l.warning+2,2),false);
        // Real acceleration, reaction delay, no Dash or speed pickup.
        let t=.3;
        while(t<l.warning-.05 && Math.hypot(q.x-p.x,q.y-p.y)>3) {
          const d=Math.hypot(q.x-p.x,q.y-p.y);
          moveBody(p,{x:(q.x-p.x)/d,y:(q.y-p.y)/d},.01); t+=.01;
        }
        assert.ok(Math.hypot(q.x-p.x,q.y-p.y)<4,`${mode} body ${i}`);
        assert.equal(laserContact(l,p,l.warning),false);
      });
    }
    assert.equal(makeLaserLayout(kind,[{...player(),radius:500}],2,"chaos"),undefined);
    assert.equal(makeLaserLayout(kind,[player()],2,"classic",600),undefined);
    assert.equal(makeLaserLayout(kind,[],0,"classic"),undefined);
  });
  test(`${kind}: complete engine warning, damage cooldown, reward and cleanup`, () => {
    const id=kind==="grid"?10:11,p=player(),engine=new RuleEngine(random(id),"blitz");
    engine.state.phase="announce";engine.state.ids=[id];engine.state.remaining=0;
    const hit=()=>damageBody(p);
    let rewards=0;
    const update=dt=>engine.update(dt,35,[p],hit,()=>rewards++);
    for(let i=0;i<1000 && engine.state.phase!=="active";i++) update(.01);
    const l=engine.state.laserLayout;
    assert.ok(l);
    Object.assign(p,kind==="grid"?{x:l.lines[0].x1,y:180}:{x:580+110,y:399});
    for(let i=0;i<100;i++) update(.01);
    assert.equal(p.hp,3);
    for(let i=0;i<25;i++) update(.01);
    assert.equal(p.hp,2);
    Object.assign(p,l.safe[0]);
    for(let i=0;i<1000 && engine.state.phase==="active";i++) update(.01);
    assert.equal(engine.state.phase,"rest");
    assert.equal(engine.state.laserLayout,undefined);
    assert.equal(rewards,0,"damaged round is not rewarded");
    for(let other=0;other<18;other++) assert.equal(compatible(id,other),SAFE_PAIRS.some(c=>c.includes(id)&&c.includes(other)&&id!==other),"only certified candidates");
  });
  test(`${kind}: authoritative room snapshots, eight players, repeated Rematch`, () => {
    const room=new Room("ABC234",random(kind==="grid"?10:11));
    for(let i=0;i<8;i++) room.join(`p${i}`,`session${i}`,`Player ${i}`,0);
    assert.equal(room.command("p0",{type:"mode",mode:"chaos"}),true);
    for(let round=0;round<3;round++) {
      for(let i=0;i<8;i++) room.command(`p${i}`,{type:"ready",ready:true});
      assert.equal(room.command("p0",{type:"start"}),true);
      for(let i=0;i<300 && !room.rules.state.laserLayout;i++) room.tick(.05);
      const wire=JSON.parse(JSON.stringify(room.snapshot()));
      assert.equal(wire.protocol,PROTOCOL_VERSION);
      assert.equal(wire.players.length,8);
      assert.equal(wire.rules.laserLayout.kind,kind);
      assert.deepEqual(wire.rules.laserLayout,JSON.parse(JSON.stringify(room.rules.state.laserLayout)));
      const victim=room.members.get("p0").state,l=room.rules.state.laserLayout;
      Object.assign(victim,kind==="grid"?{x:l.lines[0].x1,y:180}:{x:690,y:399});
      for(let i=0;i<Math.ceil((l.warning+.3)/.05);i++) room.tick(.05);
      assert.ok(victim.hp<3,"server applies damage without client collision messages");
      for(const m of room.members.values()) m.state.hp=0;
      room.tick(.05);
      assert.equal(room.phase,"results");
      assert.equal(room.rules.state.laserLayout,undefined);
      assert.equal(room.command("p0",{type:"rematch"}),true);
    }
    assert.equal(parseClientMessage(JSON.stringify({type:"input",x:0,y:0,laserLayout:{}})),null);
  });
}

test("difficulty increases grid density and spin speed without removing refuge", () => {
  assert.ok(makeLaserLayout("grid",[player()],2,"classic").lines.length>makeLaserLayout("grid",[player()],0,"classic").lines.length);
  assert.ok(makeLaserLayout("spin",[player()],2,"chaos").speed>makeLaserLayout("spin",[player()],0,"classic").speed);
  const l=makeLaserLayout("spin",[player()],2,"chaos");
  assert.ok(l.outer*l.speed<265);
  assert.ok(reachableSafe(l,player()));
});

test("unsafe configurations are skipped without damage or rewards", () => {
  for(const id of [10,11]) {
    const engine=new RuleEngine(random(id));
    const p={...player(),radius:500};
    let hits=0,rewards=0;
    engine.state.phase="announce";
    engine.state.ids=[id];
    engine.state.remaining=0;
    engine.update(.01,0,[p],()=>hits++,()=>rewards++);
    assert.equal(engine.state.phase,"rest");
    assert.equal(engine.state.laserLayout,undefined);
    assert.equal(hits+rewards,0);
  }
});

test("renderer uses serialized laser geometry, warning markers and bounded draw calls in RU/EN", () => {
  const calls=[];
  const g=new Proxy({}, {get:(_,method)=>(...args)=>{calls.push([method,...args]);return g;}});
  const { RuleView }=loadModule("ruleView",{}, {phaser:{default:{}}});
  const locales=loadModule("locales/index");
  // Each loadModule has an isolated locale; inject the same locale for the view.
  const viewModule=loadModule("ruleView",{}, {phaser:{default:{}},"./locales":locales});
  const view=new RuleView({add:{graphics:()=>g,text:()=>g}});
  for(const kind of ["grid","spin"]) {
    const engine=new RuleEngine(random(kind==="grid"?10:11));
    while(engine.state.phase!=="active") engine.update(.01,0,[player()],()=>{},()=>{});
    const s=JSON.parse(JSON.stringify(engine.state));
    calls.length=0; view.draw(s);
    assert.ok(calls.some(c=>c[0]==="strokeCircle"));
    assert.ok(calls.filter(c=>c[0]==="lineBetween").length<=16);
    for(const lang of ["ru","en"]) {
      locales.setLocale(lang);
      assert.ok(viewModule.ruleTitle(s).length);
      assert.ok(viewModule.ruleSubtitle(s).length);
      assert.ok(viewModule.ruleStatus(s).length);
    }
    s.elapsed=s.laserLayout.warning+.5;
    calls.length=0; view.draw(s);
    assert.equal(calls.filter(c=>c[0]==="lineBetween").length,laserLines(s.laserLayout,s.elapsed).length*2);
    s.phase="rest";calls.length=0;view.draw(s);
    assert.equal(calls.filter(c=>c[0]==="lineBetween").length,0);
  }
});
