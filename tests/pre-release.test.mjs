import {test} from "node:test";
import assert from "node:assert/strict";
import {loadModule} from "./load.mjs";
const {RuleEngine}=loadModule("shared/ruleEngine");
const {seededRandom}=loadModule("shared/offlineProgress");
const {createBody}=loadModule("shared/movement");
const {Room}=loadModule("shared/room");
const {blankProgression,recordOnline,resultFromSnapshot}=loadModule("shared/progression");

// Simulation stress only. No sockets, browser rendering or Cloudflare runtime.
for(const mode of ["survival","chaos"])test(`${mode}: 30 simulated minutes keep event state bounded and complete hundreds of cycles`,()=>{
  const e=new RuleEngine(seededRandom(12345),mode),body={...createBody(),id:"p"};
  let completed=0,maxHazards=0,combos=0;
  for(let tick=1;tick<=36000;tick++) {
    const phase=e.state.phase,serial=e.state.serial;
    e.update(.05,tick*.05,[body],()=>false,()=>{});
    if(phase==="active"&&e.state.phase==="rest") {
      completed++;assert.equal(e.state.hazards.length,0);
      assert.equal(e.state.laserLayout,undefined);assert.equal(e.state.burstLayout,undefined);
      assert.equal(e.state.swarmTiles,undefined);assert.equal(e.state.collapse,undefined);
    }
    if(e.state.serial!==serial&&e.state.ids.length>1)combos++;
    maxHazards=Math.max(maxHazards,e.state.hazards.length);
    assert.ok(e.state.hazards.length<160);
    assert.ok(e.state.remaining>=-.06);
    assert.ok(e.state.tier<=2);
  }
  assert.ok(completed>150);assert.ok(combos>10);
  assert.ok(maxHazards>0);
});

for(const mode of ["classic","lastOneStanding","blitz","chaos"])test(`${mode}: capacities 2–8, host-only selection and five consecutive authoritative Rematches`,()=>{
  for(let count=2;count<=8;count++) {
    const r=new Room("ABC234",seededRandom(42)),progress=blankProgression();
    for(let i=0;i<count;i++)r.join(`p${i}`,`secret${i}`,`Player${i}`,i);
    assert.equal(r.command("p1",{type:"mode",mode}),false);
    assert.equal(r.command("p0",{type:"mode",mode}),true);
    for(let round=0;round<5;round++) {
      for(const id of r.members.keys())r.command(id,{type:"ready",ready:true});
      assert.equal(r.command("p1",{type:"start"}),false);
      assert.equal(r.command("p0",{type:"start"}),true);
      r.tick(3.1);
      for(const m of r.members.values())m.state.invulnerable=120;
      for(let i=0;i<500;i++)r.tick(.05);
      assert.equal(r.phase,"playing");
      // Force an outcome to isolate lifecycle/accounting from player skill.
      if(mode==="blitz") {
        r.time=89.99;for(const m of r.members.values())m.scoring.bonus=100;
        r.tick(.05);assert.equal(r.winnerId,null);
      } else {
        for(const [id,m] of r.members) if(id!=="p0"){m.state.hp=0;m.state.eliminatedAt=r.time;}
        r.tick(.05);assert.equal(r.winnerId,"p0");
      }
      const result=resultFromSnapshot(r.snapshot(),"p0");assert.ok(result);
      recordOnline(progress,result);for(let repeat=0;repeat<25;repeat++)assert.equal(recordOnline(progress,result),null);
      assert.equal(progress.online[mode].games,round+1);
      assert.equal(r.command("p1",{type:"rematch"}),false);
      assert.equal(r.command("p0",{type:"rematch"}),true);
      assert.equal(r.phase,"lobby");assert.equal(r.snapshot().players.length,count);
    }
  }
});
