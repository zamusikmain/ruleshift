import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load.mjs";
const {loadProfile}=loadModule("profile");
const {dailySpec}=loadModule("shared/offlineProgress");
const {createBody}=loadModule("shared/movement");
const noop=()=>{};
function scene(mode) {
  const profile=loadProfile(),results=[],hud=[];
  const {ArenaScene}=loadModule("scenes/ArenaScene",{document:{querySelector:()=>({hidden:false})}},{
    phaser:{default:{Scene:class{}}},"../player":{},"../rules":{},"../input":{},
    "../ui":{notifyAchievements:noop,notifyProgress:noop,showOfflineResults:(...args)=>results.push(args),showResults:()=>results.push("standard")},
    "../profile":{profile,persistProfile:noop,unlockAchievements:()=>[]},
    "../locales":{t:key=>key},"../audio":{},"../arena":{},
    "../hud":{hideHud:noop,showHud:(...args)=>hud.push(args)},"../device":{isPortraitTouch:()=>true},"../online/client":{},
    "../featureView":{showAbilities:noop},
  });
  const s=new ArenaScene();
  Object.assign(s,{mode,running:true,paused:false,survival:0,hudClock:1,
    controls:{setEnabled:noop},add:{rectangle:()=>({setDepth:noop})},
    player:{hp:3,state:createBody(580,399),update:noop},
    rules:{engine:{state:{phase:"rest",ids:[],modifiers:{}}},update:noop},
  });
  if(mode==="daily") s.daily=dailySpec(new Date("2026-10-09T12:00:00Z"));
  return {s,profile,results,hud};
}

test("Blitz displays the remaining match time, freezes on pause and finishes exactly once",()=>{
  const {s,results,hud}=scene("blitz");
  s.hudClock=0;s.step(.05);
  assert.equal(hud.at(-1)[6],"blitz · 01:30");
  s.survival=89;s.hudClock=0;s.step(.05);
  assert.equal(hud.at(-1)[6],"blitz · 00:01");
  s.paused=true;s.update(0,50);assert.equal(s.survival,89.05);
  s.paused=false;s.survival=89.99;s.step(.02);s.finish();
  assert.equal(s.running,false);assert.equal(results.length,1);
});
test("Survival scene continues beyond 90 seconds, counts survived events, and saves defeat once",()=>{
  const {s,profile,results}=scene("survival");
  s.survival=10000;
  s.rules.engine.state.phase="active";
  s.rules.engine.state.ids=[0];
  s.rules.update=()=>{s.rules.engine.state.phase="rest";};
  s.step(.02);
  assert.equal(s.running,true);
  assert.equal(s.survivedEvents,1);
  s.player.hp=0;s.step(.02);s.finish();
  assert.equal(results.length,1);
  assert.equal(results[0][0],"survival");
  assert.equal(profile.offline.survival.games,1);
  assert.ok(profile.offline.survival.bestTime>10000);
  assert.equal(profile.offline.survival.bestEvents,1);
});
test("Daily scene ends with success at 90 seconds or failure on death; replays do not duplicate medals",()=>{
  const {s,profile,results}=scene("daily");
  s.survival=90-1/120;s.step(1/60);s.finish();
  assert.equal(results[0][0],"daily");
  assert.equal(results[0][1].time,90);
  assert.equal(results[0][3],true);
  assert.equal(profile.offline.localDailyMedals,1);
  s.running=true;s.survival=90-1/120;s.step(1/60);
  assert.equal(results[1][4],false);
  assert.equal(profile.offline.localDailyMedals,1);
  s.running=true;s.survival=10;s.player.hp=0;s.step(1/60);
  assert.equal(results[2][3],false);
  assert.equal(profile.offline.daily[0].attempts,3);
});
test("Daily fixed simulation steps are frame-rate independent, pause-aware and bypass pickups",()=>{
  const a=scene("daily").s,b=scene("daily").s;
  let aTicks=0,bTicks=0,pickups=0;
  a.rules.update=dt=>{assert.equal(dt,1/60);aTicks++;};
  b.rules.update=dt=>{assert.equal(dt,1/60);bTicks++;};
  a.pickups.update=b.pickups.update=()=>pickups++;
  for(let i=0;i<120;i++)a.update(0,1000/60);
  for(let i=0;i<40;i++)b.update(0,50);
  assert.equal(aTicks,bTicks);
  assert.equal(a.survival,b.survival);
  assert.equal(pickups,0);
  a.paused=true;a.update(0,50);assert.equal(aTicks,120);
  let onlineTicks=0;a.online={update:()=>onlineTicks++};a.update(0,50);
  assert.equal(onlineTicks,1);assert.equal(aTicks,120);
});
test("Survival and Daily permit portrait touch; existing modes retain landscape restriction",()=>{
  for(const mode of ["survival","daily"]) assert.equal(scene(mode).s.requiresLandscape(),false);
  for(const mode of ["classic","blitz","chaos"]) assert.equal(scene(mode).s.requiresLandscape(),true);
  const classes=new Set(["playing"]),rotate={hidden:false};
  const {updateOrientation}=loadModule("device",{
    navigator:{maxTouchPoints:1},matchMedia:()=>({matches:true}),
    document:{body:{classList:{contains:name=>classes.has(name)}},querySelector:()=>rotate},
  });
  updateOrientation();assert.equal(rotate.hidden,false);
  classes.add("portrait-offline");updateOrientation();assert.equal(rotate.hidden,true);
  classes.delete("portrait-offline");classes.delete("playing");updateOrientation();assert.equal(rotate.hidden,true);
});
test("Daily timer completes on exactly 5400 simulation ticks and never records a second result",()=>{
  const {s,results}=scene("daily");
  for(let i=0;i<5399;i++) s.update(0,1000/60);
  assert.equal(s.running,true);assert.equal(results.length,0);
  s.update(0,1000/60);
  assert.equal(s.running,false);assert.equal(s.survival,90);
  for(let i=0;i<20;i++)s.update(0,50);
  assert.equal(results.length,1);
});
test("Real Offline finishing records progress once; paused frames and voluntary quit grant no XP",()=>{
  const {s,profile}=scene("survival");
  s.runKey="run-a";s.survival=90;s.survivedEvents=10;s.scoring.perfects=8;
  s.paused=true;for(let i=0;i<100;i++)s.update(0,50);
  assert.equal(s.survival,90);assert.equal(profile.progression.xp,0);
  s.finish("quit");s.finish();
  assert.equal(profile.progression.xp,0);assert.equal(profile.progression.offline.survival.games,1);
  s.running=true;s.runKey="run-b";s.finish();
  assert.ok(profile.progression.xp>0);
  const xp=profile.progression.xp;s.finish();assert.equal(profile.progression.xp,xp);
});
test("Real Daily finishing and replay update records but give XP on only the first completion",()=>{
  const {s,profile}=scene("daily");
  s.runKey="daily-first";s.survival=90;s.survivedEvents=10;s.scoring.perfects=8;
  s.finish();const xp=profile.progression.xp;assert.ok(xp>0);
  s.running=true;s.runKey="daily-replay";s.scoring.bonus=999;s.finish();
  assert.equal(profile.progression.xp,xp);
  assert.equal(profile.progression.offline.daily.games,2);
  assert.equal(profile.offline.localDailyMedals,1);
});

test("Offline cancellation cannot grant survived-event progress",()=>{
  const {s}=scene("survival");
  s.rules.engine.state.phase="active";s.rules.engine.state.ids=[20,24];
  s.rules.update=()=>{s.rules.engine.state.phase="rest";s.rules.engine.state.ids=[];};
  s.step(.02);assert.equal(s.survivedEvents,0);
});
