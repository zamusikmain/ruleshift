import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './load.mjs';
const plain=v=>JSON.parse(JSON.stringify(v));
test('controls preserve legacy size and validate separate type/sensitivity/dead-zone settings',()=>{
 const values=new Map([['ruleshift.controls.v1','small'],['ruleshift.controls.v2',JSON.stringify({type:'floating',sensitivity:99,deadZone:-10})]]);
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 const c=loadModule('controlSettings',{localStorage:storage});
 assert.equal(c.joystickSize,'small');assert.deepEqual(plain(c.controlOptions),{type:'floating',sensitivity:1.5,deadZone:.05});
 c.setControlOptions({type:'floating',sensitivity:.75,deadZone:.3});
 assert.equal(c.loadControlOptions(storage).sensitivity,.75);assert.equal(values.get('ruleshift.controls.v1'),'small');
 values.set(c.OPTIONS_KEY,'broken');assert.equal(c.loadControlOptions(storage).type,'fixed');
});
test('floating joystick owns one pointer, excludes UI and allows independent Dash and ability',()=>{
 const classes=new Set(),base=new EventTarget(),dash=new EventTarget(),wave=new EventTarget(),window=new EventTarget(),document=new EventTarget();
 base.style={};base.classList={add:n=>classes.add(n),remove:n=>classes.delete(n)};
 const thumb={style:{}};base.querySelector=()=>thumb;
 base.getBoundingClientRect=()=>({left:Number.parseFloat(base.style.left)||0,top:Number.parseFloat(base.style.top)||0,width:100,height:100});
 let captured=null;base.setPointerCapture=id=>captured=id;base.hasPointerCapture=id=>captured===id;base.releasePointerCapture=()=>captured=null;
 document.querySelector=id=>({'#joystick':base,'#dash-button':dash,'#wave-button':wave,'#game':{getBoundingClientRect:()=>({left:0,top:0,width:800,height:500,bottom:500})}}[id]);
 document.body={classList:{toggle:(n,v)=>v?classes.add(n):classes.delete(n)}};
 const keys=Object.fromEntries('W A S D UP DOWN LEFT RIGHT'.split(' ').map(n=>[n,{isDown:false,reset(){this.isDown=false;}}]));
 const {UnifiedInput}=loadModule('input',{window,document,AbortController},{phaser:{default:{Scenes:{Events:{SHUTDOWN:'shutdown'}}}},'./controlSettings':{controlOptions:{type:'floating',sensitivity:1,deadZone:.22},JOYSTICK_TRAVEL:.32}});
 const input=new UnifiedInput({input:{keyboard:{addKeys:()=>keys}},events:{once:()=>{}}});input.setEnabled(true);
 const pointer=(target,type,id,x=100,y=300,interactive=false)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y,pointerType:'touch'});target.closest=()=>interactive?{}:null;target.dispatchEvent(e);};
 pointer(document,'pointerdown',9,100,300,true);assert.equal(captured,null);
 pointer(document,'pointerdown',1);assert.equal(captured,1);assert.equal(input.read().x,0);
 pointer(base,'pointermove',1,135);assert.ok(input.read().x>0);
 pointer(dash,'pointerdown',2);pointer(wave,'pointerdown',3);assert.equal(input.consumeDash(),true);assert.equal(input.consumeWave(),true);
 pointer(base,'pointercancel',2);assert.ok(input.read().x>0);pointer(base,'pointercancel',1);assert.equal(input.read().x,0);assert.equal(captured,null);
 pointer(document,'pointerdown',4,200,350);assert.equal(captured,4);assert.equal(base.style.left,'150px');window.dispatchEvent(new Event('resize'));assert.equal(captured,null);
 input.destroy();
});
test('Pulse only removes active hunters/projectiles, preserves warnings, walls, mines and distant enemies',()=>{
 const {pulseThreats}=loadModule('shared/pulse');const {RuleEngine}=loadModule('shared/ruleEngine');const {createBody}=loadModule('shared/movement');
 const p={...createBody(),id:'a'},e=new RuleEngine();const s=e.state;s.phase='active';s.elapsed=3;
 s.hazards=[['hunter',0],['shot',0],['zone',0],['meteor',0],['hunter',250]].map(([kind,dx])=>({kind,x:p.x+dx,y:p.y,radius:10,vx:0,vy:0,born:0}));
 s.swarmTiles={kind:'swarm',warning:1.25,hunters:[{x:p.x,y:p.y},{x:p.x+250,y:p.y}]};
 const threat={shape:'disc',a:{x:p.x,y:p.y},b:{x:p.x,y:p.y},radius:7,velocity:{x:0,y:0},active:2,end:4,warning:0};
 s.overdriveLayers=[{kind:'bulletStorm',threats:[{...threat},{...threat,active:4}]},{kind:'minefield',threats:[threat]}];
 assert.equal(pulseThreats(s,p),4);assert.equal(s.hazards.length,3);assert.equal(s.swarmTiles.hunters.length,1);assert.equal(s.overdriveLayers[0].threats.length,1);assert.equal(s.overdriveLayers[1].threats.length,1);assert.equal(pulseThreats(s,p),0);
});
test('server Pulse consumes one charge and rejects repeated, dead and lobby activation',()=>{
 const {Room}=loadModule('shared/room');const room=new Room('ABCDEF');room.join('a','secret','Alice',0);const p=room.members.get('a').state;
 p.shockwave=true;assert.equal(room.command('a',{type:'shockwave'}),false);room.phase='playing';room.rules.state.phase='active';room.rules.state.elapsed=3;
 room.rules.state.hazards=[{kind:'hunter',x:p.x,y:p.y,radius:10,vx:0,vy:0,born:0}];
 assert.equal(room.command('a',{type:'shockwave'}),true);assert.equal(p.shockwave,false);assert.equal(room.rules.state.hazards.length,0);assert.equal(room.command('a',{type:'shockwave'}),false);
 p.shockwave=true;assert.equal(room.command('a',{type:'shockwave'}),false);p.waveTime=0;p.hp=0;assert.equal(room.command('a',{type:'shockwave'}),false);
});
test('Near Miss cannot reward stationary farming and still deduplicates a moving dodge',()=>{
 const {RuleEngine}=loadModule('shared/ruleEngine');const {createBody}=loadModule('shared/movement');const e=new RuleEngine(),p={...createBody(),id:'a'};let near=0;
 Object.assign(e.state,{phase:'active',ids:[3],elapsed:1,remaining:4,hazards:[{kind:'shot',id:42,x:p.x+20,y:p.y+20,radius:7,vx:1,vy:0,born:0}]});e.nextShot=99;
 const tick=()=>e.update(.01,0,[p],()=>false,()=>{},()=>{},()=>near++);
 tick();assert.equal(near,0);p.distance=1;tick();tick();assert.equal(near,1);
});
test('audio volume clamps, persists, and mute does not create an oscillator',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};let oscillators=0;
 const a=loadModule('audio',{localStorage:storage},{'./profile':{profile:{sound:true},persistProfile:()=>{}}});
 a.setSoundVolume(.25);assert.equal(values.get('ruleshift.volume.v1'),'0.25');assert.equal(loadModule('audio',{localStorage:storage}).soundVolume,.25);
 a.setSoundVolume(NaN);assert.equal(a.soundVolume,.25);a.setSoundVolume(2);assert.equal(a.soundVolume,1);
 a.audio.context={state:'running',createOscillator:()=>{oscillators++;}};a.setSoundVolume(0);a.audio.play('dash');assert.equal(oscillators,0);
});
test('server Near Miss requires fresh intentional input, not force or knockback motion',()=>{
 const {Room}=loadModule('shared/room');const room=new Room('ABCDEF');room.join('a','secret','Alice',0);room.join('b','secret2','Bob',1);room.phase='playing';
 const m=room.members.get('a');m.state.knockTime=.18;m.state.knockX=1;
 room.rules.update=(_dt,_time,_players,_hit,_reward,_fail,near)=>near('a');
 room.tick(.05);assert.equal(m.scoring.nearMisses,0);
 room.command('a',{type:'input',x:1,y:0});room.tick(.05);assert.equal(m.scoring.nearMisses,1);
 room.clock+=1;room.tick(.05);assert.equal(m.scoring.nearMisses,1);
});
