import {test} from "node:test";
import assert from "node:assert/strict";
import {loadModule} from "./load.mjs";
const p=loadModule("shared/progression");
const {Room,RECONNECT_GRACE}=loadModule("shared/room");
const {parseClientMessage,PROTOCOL_VERSION}=loadModule("shared/protocol");
const {loadProfile,persistProfile,unlockAchievements,ACHIEVEMENTS}=loadModule("profile");
const plain=v=>JSON.parse(JSON.stringify(v));
const run={time:90,score:1500,events:10,perfects:8,combos:3,damage:1};
function room(count=2) {
  const r=new Room("ABC234");
  for(let i=0;i<count;i++){r.join(`p${i}`,`secret${i}`,`Player${i}`,i);r.command(`p${i}`,{type:"ready",ready:true});}
  r.command("p0",{type:"start"});r.tick(3.1);return r;
}
function completed(r,win="p0") {
  r.time=90;r.phase="results";r.winnerId=win;
  for(const m of r.members.values()) Object.assign(m.state,{score:1500,rules:8,eventsSurvived:10,perfects:8,chaos:3,eliminatedAt:90});
  return r.snapshot();
}

test("Offline records remain independent by mode; quits, short runs and duplicate callbacks cannot farm XP",()=>{
  const data=p.blankProgression();
  for(const mode of ["classic","survival","blitz","chaos"]) {
    const n=p.recordOffline(data,mode,mode,run,true);assert.ok(n.xp>0&&n.xp<=200);
    assert.equal(p.recordOffline(data,mode,mode,run,true),null);
    assert.equal(data.offline[mode].games,1);assert.equal(data.offline[mode].bestScore,1500);
  }
  assert.equal(data.offline.daily.games,0);
  assert.equal(p.recordOffline(data,"quit","survival",run,false).xp,0);
  assert.equal(p.recordOffline(data,"short","classic",{...run,time:2},true).xp,0);
  assert.equal(p.recordOffline(data,"idle","classic",{...run,events:0},true).xp,0);
});

test("Daily completion grants XP once per UTC date across reload, even if a replay scores higher",()=>{
  let data=p.blankProgression();
  assert.equal(p.recordOffline(data,"fail","daily",run,true,false,"2026-10-09").xp,0);
  assert.ok(p.recordOffline(data,"first","daily",run,true,true,"2026-10-09").xp>0);
  data=p.readProgression(plain(data));
  assert.equal(p.recordOffline(data,"replay","daily",{...run,score:2000},true,true,"2026-10-09").xp,0);
  assert.equal(data.offline.daily.bestScore,2000);
  assert.ok(p.recordOffline(data,"next","daily",run,true,true,"2026-10-10").xp>0);
});

test("Eight players receive server-based win/loss/draw stats and repeated snapshots do not reward twice",()=>{
  const r=room(8),snapshot=completed(r);
  for(let i=0;i<8;i++) {
    const data=p.blankProgression(),result=p.resultFromSnapshot(snapshot,`p${i}`);
    assert.ok(result);assert.equal(result.events,10);assert.equal(result.cleanRules,8);
    assert.ok(p.recordOnline(data,result).xp>0);
    for(let repeat=0;repeat<30;repeat++)assert.equal(p.recordOnline(data,result),null);
    assert.equal(data.online.classic.games,1);
    assert.equal(data.online.classic.wins,i===0?1:0);
    assert.equal(data.online.classic.losses,i===0?0:1);
    assert.equal(p.winRate(data.online.classic),i===0?100:0);
  }
  const data=p.blankProgression();
  p.recordOnline(data,p.resultFromSnapshot(completed(r,null),"p0"));
  assert.equal(data.online.classic.draws,1);assert.equal(data.online.classic.streak,0);
});

test("Online per-mode streaks, Rematch IDs and reconnect/reload use a persistent high-water mark",()=>{
  const data=p.blankProgression(),r=room();
  for(let i=0;i<3;i++) {
    p.recordOnline(data,p.resultFromSnapshot(completed(r),"p0"));
    r.command("p0",{type:"rematch"});
    for(const id of ["p0","p1"])r.command(id,{type:"ready",ready:true});
    r.command("p0",{type:"start"});r.tick(3.1);
  }
  assert.equal(data.online.classic.games,3);assert.equal(data.online.classic.bestStreak,3);
  const restored=p.readProgression(plain(data));
  const old=completed(r);old.matchId=2;
  assert.equal(p.recordOnline(restored,p.resultFromSnapshot(old,"p0")),null);
  r.mode="chaos";
  p.recordOnline(restored,p.resultFromSnapshot(completed(r,null),"p0"));
  assert.equal(restored.online.chaos.draws,1);assert.equal(restored.online.classic.streak,3);
  r.matchId++;r.mode="classic";
  p.recordOnline(restored,p.resultFromSnapshot(completed(r,"p1"),"p0"));
  assert.equal(restored.online.classic.streak,0);assert.equal(restored.online.classic.bestStreak,3);
});

test("Voluntary exit and expired reconnect grace are server forfeits with zero XP; quick reconnect is preserved",()=>{
  const r=room(3);r.time=40;
  const m=r.members.get("p0");m.scoring.complete(3);m.state.rules=3;m.state.eventsSurvived=3;m.state.perfects=1;
  r.disconnect("p0");r.tick(.1);
  assert.equal(m.state.forfeited,false);
  assert.equal(r.join("replacement","other","Player0",0,"secret0").id,"p0");
  r.command("p0",{type:"leave"});
  const result=p.resultFromSnapshot(r.snapshot(),"p0"),data=p.blankProgression();
  assert.equal(result.forfeited,true);assert.equal(result.outcome,"loss");
  assert.equal(p.recordOnline(data,result).xp,0);
  r.phase="results";r.winnerId="p1";
  assert.equal(p.recordOnline(data,p.resultFromSnapshot(r.snapshot(),"p0")),null);
  const second=room(3);second.time=40;second.disconnect("p1");second.tick(RECONNECT_GRACE+.01);
  assert.equal(p.resultFromSnapshot(second.snapshot(),"p1").forfeited,true);
});

test("Countdown cancellation, live snapshots and client result submissions cannot grant progress",()=>{
  const r=room();assert.equal(p.resultFromSnapshot(r.snapshot(),"p0"),null);
  const s=r.snapshot();s.phase="countdown";s.players[0].forfeited=true;
  assert.equal(p.resultFromSnapshot(s,"p0"),null);
  assert.equal(parseClientMessage(JSON.stringify({type:"result",score:99999,winnerId:"p0",xp:9999})),null);
  assert.equal(parseClientMessage(JSON.stringify({type:"input",x:0,y:0,xp:9999})),null);
  assert.equal(PROTOCOL_VERSION,8);
});

test("Server counts damaged-but-survived events once and resets them on Rematch",()=>{
  const r=room();r.time=30;r.rules.state.phase="active";r.rules.state.ids=[0];
  r.rules.update=()=>{r.rules.state.phase="rest";};
  r.members.get("p0").state.damageTaken=1;r.tick(.01);
  assert.equal(r.snapshot().players[0].eventsSurvived,1);
  r.tick(.01);assert.equal(r.snapshot().players[0].eventsSurvived,1);
  completed(r);r.command("p0",{type:"rematch"});
  for(const id of ["p0","p1"])r.command(id,{type:"ready",ready:true});
  r.command("p0",{type:"start"});
  assert.equal(r.snapshot().players[0].eventsSurvived,0);
});

test("Old achievements and Survival/Daily records migrate without invented XP or repeat Daily awards",()=>{
  const storage={getItem:key=>key==="ruleshift.profile.v1"?JSON.stringify({version:1,stats:{wins:10},achievements:["onlineWinner","first"],offline:{survival:{games:2,bestTime:300,bestScore:1000,bestEvents:20},daily:[{date:"2026-10-09",time:90,score:900,events:9,completed:true,rewarded:true,attempts:1}],localDailyMedals:1}}):null};
  const profile=loadProfile(storage);
  assert.equal(profile.progression.xp,0);assert.equal(profile.stats.wins,10);
  assert.equal(profile.progression.offline.survival.bestTime,300);
  assert.ok(profile.progression.dailyAwards.includes("2026-10-09"));
  assert.ok(profile.achievements.includes("onlineWinner"));
  const fresh=unlockAchievements(profile);assert.ok(fresh.includes("dailyFirst")&&fresh.includes("survival300"));
  assert.equal(unlockAchievements(profile).length,0);
  assert.equal(ACHIEVEMENTS.length,17);
});

test("All new difficult achievements have reachable conditions and unlock exactly once",()=>{
  const profile=loadProfile(),data=profile.progression;
  data.online.classic.wins=5;data.online.classic.bestStreak=3;
  data.offline.survival.bestTime=300;profile.offline.localDailyMedals=7;
  data.offline.chaos.totalEvents=100;data.offline.chaos.bestCombos=5;
  data.offline.classic.bestPerfects=20;data.offline.blitz.cleanBlitz=true;
  const unlocked=unlockAchievements(profile);
  for(const id of ["onlineFive","onlineStreak3","survival300","dailyFirst","dailySeven","events100","precision20","chaosFive","cleanBlitz"]) assert.ok(unlocked.includes(id),id);
  assert.equal(unlockAchievements(profile).length,0);
});

test("XP levels increase predictably, corrupt data is sanitized and profile progress roundtrips",()=>{
  assert.equal(p.levelProgress(0).level,1);assert.equal(p.levelProgress(99).level,1);
  assert.equal(p.levelProgress(100).level,2);assert.equal(p.levelProgress(400).level,3);
  assert.equal(p.levelProgress(1e9).level,100);
  const clean=p.readProgression({xp:-2,offline:{classic:{bestScore:Infinity}},online:{classic:{wins:2,losses:1,draws:1,streak:99}},onlineCursors:{"__proto__":3},offlineRuns:[null,4,"a","a"]});
  assert.equal(clean.xp,0);assert.equal(clean.offline.classic.bestScore,0);
  assert.equal(clean.online.classic.games,4);assert.equal(clean.online.classic.streak,2);
  assert.deepEqual(plain(clean.offlineRuns),["a"]);
  let saved;const profile=loadProfile();profile.progression=clean;
  persistProfile(profile,{setItem:(_,value)=>{saved=value;}});
  assert.deepEqual(plain(loadProfile({getItem:key=>key==="ruleshift.profile.v1"?saved:null}).progression),plain(clean));
});

test("Replay protection uses bounded cursors and fails closed rather than evicting old Online receipts",()=>{
  const data=p.blankProgression();
  for(let i=0;i<4096;i++)data.onlineCursors[`ABC234:p${i}`]=1;
  const r=p.resultFromSnapshot(completed(room()),"p0");
  assert.equal(p.recordOnline(data,r),null);
  assert.equal(p.recordOnline(data,{...r,participantKey:"ABC234:new"}),null);
  assert.equal(Object.keys(data.onlineCursors).length,4096);
});
