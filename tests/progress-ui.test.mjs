import {test} from "node:test";
import assert from "node:assert/strict";
import {loadModule} from "./load.mjs";
const noop=()=>{};
test("Progress notifications respect all effect levels and have a bounded queue and timer count",()=>{
  for(const level of ["low","medium","high"]) {
    const toast={hidden:true},timers=[];
    const overlay={};
    const {notifyProgress}=loadModule("ui",{
      document:{querySelector:s=>s==="#overlay"?overlay:toast},
      window:{addEventListener:noop},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:noop,
    },{phaser:{},"./audio":{audio:{play:noop}},"./effects":{effectsLevel:level}});
    notifyProgress({xp:100,record:true,levelUp:true},["dailyFirst"]);
    assert.equal(toast.className,`notice-${level}`);
    assert.ok(toast.textContent.includes("100 XP")&&toast.textContent.includes("personal record")&&toast.textContent.includes("DAILY FINISHER"));
    for(let i=0;i<100;i++)notifyProgress({xp:1,record:false,levelUp:false},[]);
    assert.equal(timers.length,1);
    let displayed=0;while(timers.length){timers.shift()();displayed++;assert.ok(displayed<=5);}
    assert.equal(toast.hidden,true);
  }
});
test("Online client waits for authoritative exit acknowledgement, applies zero-XP loss and exits once",()=>{
  const profile=loadModule("profile").loadProfile(),timers=[];
  let exits=0,closes=0,saves=0;
  const {OnlineClient}=loadModule("online/client",{
    document:{hidden:false,querySelector:()=>({hidden:true}),body:{classList:{remove:noop}}},
    setTimeout:fn=>{timers.push(fn);return 1;},clearTimeout:noop,clearInterval:noop,WebSocket:{OPEN:1},
  },{phaser:{},"../profile":{profile,persistProfile:()=>saves++,unlockAchievements:()=>[]},
    "../ui":{notifyProgress:noop},"../audio":{audio:{play:noop}},
    "../featureView":{FeatureView:class{hide(){} destroy(){}},showAbilities:noop},
    "../ruleView":{RuleView:class{draw(){}}},"../hud":{hideHud:noop},
  });
  const {Room}=loadModule("shared/room"),r=new Room("ABC234");
  for(let i=0;i<3;i++){r.join(`p${i}`,`secret${i}`,`Player${i}`,i);r.command(`p${i}`,{type:"ready",ready:true});}
  r.command("p0",{type:"start"});r.tick(3.1);r.time=30;
  const c=new OnlineClient({}, {setEnabled:noop},()=>exits++,noop);
  c.id="p0";c.snapshot=r.snapshot();
  const beforeLeave=JSON.parse(JSON.stringify(c.snapshot));
  c.socket={readyState:1,send:raw=>r.command("p0",JSON.parse(raw)),close:()=>closes++};
  c.leave();c.leave();assert.equal(exits,0);assert.equal(profile.progression.online.classic.games,0);
  c.receive(beforeLeave);
  assert.equal(exits,0,"an in-flight playing snapshot is not a Leave acknowledgement");
  assert.equal(profile.progression.online.classic.games,0);
  c.receive(r.snapshot());
  assert.equal(exits,1);assert.equal(closes,1);assert.equal(saves,1);
  assert.equal(profile.progression.online.classic.losses,1);assert.equal(profile.progression.xp,0);
});
