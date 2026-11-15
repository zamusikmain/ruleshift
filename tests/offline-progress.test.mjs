import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load.mjs";
const p=loadModule("shared/offlineProgress");
const deterministicMath=Object.assign(Object.create(Math),{random(){throw Error("Unseeded gameplay randomness");}});
const { RuleEngine }=loadModule("shared/ruleEngine",{Math:deterministicMath});
const { createBody }=loadModule("shared/movement");
const { loadProfile,persistProfile }=loadModule("profile");
const plain=value=>JSON.parse(JSON.stringify(value));
const run=(time,score,events)=>({time,score,events});

test("Survival has no time limit and progression remains bounded over arbitrarily long matches",()=>{
  let previous=p.survivalDifficulty(0);
  for(const time of [10,30,60,180,600,3600,86400,1e9]) {
    const d=p.survivalDifficulty(time);
    assert.ok(d.pressure>=previous.pressure&&d.pressure<=1.15);
    assert.ok(d.rest<=previous.rest&&d.rest>=.25);
    assert.ok(d.comboChance>=previous.comboChance&&d.comboChance<=45);
    assert.ok(d.tier<=2);
    assert.equal(p.offlineFinished("survival",time,1),false);
    previous=d;
  }
  assert.equal(p.offlineFinished("survival",1e9,0),true);
  assert.equal(p.offlineFinished("daily",89.99,1),false);
  assert.equal(p.offlineFinished("daily",90,1),true);
  assert.equal(p.offlineFinished("daily",10,0),true);
});

test("Survival aggregates runs and preserves independent record maxima across reload",()=>{
  const progress=p.blankProgress();
  p.recordSurvival(progress,run(180,400,20));
  p.recordSurvival(progress,run(120,500,25));
  const restored=p.readProgress(plain(progress));
  assert.deepEqual(plain(restored.survival),{games:2,totalTime:300,totalScore:900,totalEvents:45,bestTime:180,bestScore:500,bestEvents:25});
  assert.equal(restored.daily.length,0);
});

test("Existing profile migrates without resetting achievements or Online stats; new records persist",()=>{
  const data=new Map([["ruleshift.profile.v1",JSON.stringify({version:1,name:"Player",color:0,sound:false,stats:{best:55,onlineGames:8,wins:2},achievements:["first"]})]]);
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const profile=loadProfile(storage);
  assert.equal(profile.stats.onlineGames,8);
  assert.equal(profile.stats.best,55);
  assert.deepEqual(plain(profile.achievements),["first"]);
  assert.equal(profile.offline.survival.games,0);
  p.recordSurvival(profile.offline,run(200,500,30));
  p.recordDaily(profile.offline,p.dailySpec(new Date("2026-10-09T12:00:00Z")),run(90,250,12),true);
  persistProfile(profile,storage);
  assert.deepEqual(plain(loadProfile(storage)),plain(profile));
});

test("Corrupt progress and unavailable storage cannot prevent play",()=>{
  assert.equal(p.readProgress({survival:{bestTime:-1,bestScore:Infinity},daily:[{date:"2026-02-30"},{date:"oops"}]}).daily.length,0);
  assert.equal(loadProfile({getItem(){throw Error("disabled");}}).offline.survival.bestTime,0);
  assert.doesNotThrow(()=>persistProfile(loadProfile(),{setItem(){throw Error("disabled");}}));
});

test("Daily uses UTC date across midnight and timezone offsets",()=>{
  const before=p.dailySpec(new Date("2026-10-09T23:59:59.999Z"));
  const after=p.dailySpec(new Date("2026-10-10T00:00:00Z"));
  assert.notEqual(before.seed,after.seed);
  assert.equal(p.dailySpec(new Date("2026-10-10T04:59:59+05:00")).seed,before.seed);
  assert.equal(after.date,"2026-10-10");
});

test("Daily failure, completion, replay and next day grant only one local medal per date",()=>{
  const progress=p.blankProgress(),spec=p.dailySpec(new Date("2026-10-09T23:59:00Z"));
  assert.equal(p.recordDaily(progress,spec,run(30,100,3),false),false);
  assert.equal(p.recordDaily(progress,spec,run(89,200,7),true),false);
  assert.equal(p.recordDaily(progress,spec,run(90,250,10),true),true);
  const restored=p.readProgress(plain(progress));
  assert.equal(p.recordDaily(restored,spec,run(90,300,11),true),false);
  assert.equal(p.recordDaily(restored,spec,run(40,400,5),false),false);
  assert.equal(restored.localDailyMedals,1);
  assert.equal(restored.daily[0].attempts,5);
  assert.deepEqual(plain(restored.daily[0].bestCompleted),run(90,300,11));
  const next=p.dailySpec(new Date("2026-10-10T00:00:00Z"));
  assert.equal(p.recordDaily(restored,next,run(90,200,9),true),true);
  assert.equal(restored.localDailyMedals,2);
  assert.equal(restored.daily.length,2);
  assert.equal(restored.daily[0].seed,spec.seed); // The finished run keeps its original day.
});

test("Daily history is bounded to 366 dates without duplicate rows",()=>{
  const progress=p.blankProgress();
  for(let i=0;i<400;i++) {
    const spec=p.dailySpec(new Date(Date.UTC(2025,0,1+i)));
    p.recordDaily(progress,spec,run(10,1,0),false);
    p.recordDaily(progress,spec,run(20,2,1),false);
  }
  assert.equal(progress.daily.length,366);
  assert.equal(new Set(progress.daily.map(r=>r.date)).size,366);
  assert.ok(progress.daily.every(r=>r.attempts===2));
  assert.deepEqual(plain(p.readProgress(plain(progress))),plain(progress));
});

test("Seed controls pick, inclusive ranges and shuffle without mutating input",()=>{
  const a=p.seededRandom(123),b=p.seededRandom(123),values=[1,2,3,4];
  for(let i=0;i<50;i++) {
    assert.equal(a.between(-5,10),b.between(-5,10));
    assert.equal(a.pick(values),b.pick(values));
    assert.deepEqual(plain(a.shuffle(values)),plain(b.shuffle(values)));
  }
  assert.deepEqual(values,[1,2,3,4]);
});

function scenario(seed,moving=false) {
  const engine=new RuleEngine(p.seededRandom(seed),"daily");
  const body={...createBody(580,399),id:"p"};
  const events=[];let serial=0;
  for(let tick=1;tick<=5400;tick++) {
    if(moving){body.x=180+(tick*7)%780;body.y=160+(tick*3)%430;}
    engine.update(1/60,tick/60,[body],()=>false,()=>{});
    if(engine.state.serial!==serial) {
      serial=engine.state.serial;
      const snapshot=plain(engine.state);
      if(snapshot.laserLayout) delete snapshot.laserLayout.safe;
      events.push({tick,snapshot});
    }
  }
  return events;
}
test("Entire Daily scenario is reproducible for stationary and moving players, not just its initial seed",()=>{
  const seed=p.dailySpec(new Date("2026-10-09T00:00:00Z")).seed;
  const a=scenario(seed),b=scenario(seed,true);
  assert.ok(a.length>=8);
  assert.deepEqual(b,a);
  assert.ok(a.every(e=>e.snapshot.ids.length===1&&[10,11].includes(e.snapshot.ids[0])));
  assert.notDeepEqual(scenario(p.dailySpec(new Date("2026-10-10T00:00:00Z")).seed),a);
});
