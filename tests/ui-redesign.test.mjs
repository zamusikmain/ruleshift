import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './load.mjs';
const noop=()=>{};
function harness() {
  const storage=new Map(), events=new Map(); let saved=0;
  const profile=loadModule('profile').loadProfile(); profile.name='<Player>'; profile.stats.wins=3; profile.stats.soloGames=4;profile.stats.onlineGames=5;profile.progression.online.classic.bestStreak=2;
  const nodes=new Map();const classes=new Set();const classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x))};
  const overlay={querySelector:s=>nodes.get(s),querySelectorAll:s=>s==='[data-color]'?[...nodes.values()].filter(n=>n.dataset?.color!==undefined):[],get innerHTML(){return this.html||'';},set innerHTML(html){this.html=html;nodes.clear();nodes.set('.panel',{classList});for(const tag of html.matchAll(/<[^>]+>/g)){const id=/id="([^"]+)"/.exec(tag[0]);const color=/data-color="([0-9]+)"/.exec(tag[0]);if(!id&&!color)continue;const attrs={};for(const a of tag[0].matchAll(/([a-zA-Z-]+)="([^"]*)"/g))attrs[a[1]]=a[2];const n={value:attrs.value||'',dataset:{...(color?{color:color[1]}:{})},open:/ open[ >]/.test(tag[0]),classList,focus:noop,setAttribute:(k,v)=>attrs[k]=v,getAttribute:k=>attrs[k]};nodes.set(id?'#'+id[1]:'color-'+color[1],n);}}};
  const document={querySelector:s=>s==='#overlay'?overlay:{setAttribute:noop},documentElement:{},body:{dataset:{},classList}};
  const ui=loadModule('ui',{document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},window:{location:{hash:''},addEventListener:(k,fn)=>events.set(k,fn),dispatchEvent:e=>events.get(e.type)?.()},Event:class{constructor(type){this.type=type;}}},{phaser:{},'./profile':{profile,persistProfile:()=>saved++,ACHIEVEMENTS:loadModule('profile').ACHIEVEMENTS},'./authEntry':{checkEntry:async()=>true,resetEntry:noop},'./accountProfile':{currentAccount:async()=>null,saveNickname:async()=>null},'./device':{updateOrientation:noop},'./audio':{audio:{unlock:noop,play:noop,toggle:noop}},'./controlSettings':{applyJoystickSize:noop},'./effects':{effectsLevel:'medium'}});
  return {ui,overlay,profile,nodes,classes,saved:()=>saved,click:id=>nodes.get('#'+id).onclick()};
}
test('Dashboard starts all nine existing modes using the right callbacks and keeps the Survival/Daily intro',async()=>{
  const h=harness(),offline=[],online=[];h.ui.showMenu(m=>offline.push(m),m=>online.push(m));await new Promise(resolve=>setImmediate(resolve));assert.equal((h.overlay.innerHTML.match(/class="mode-card /g)||[]).length,9);assert.ok(h.overlay.innerHTML.includes('&lt;Player&gt;'));
  for(const m of ['classic','blitz','chaos'])h.click('offline-'+m);
  for(const m of ['survival','daily']){h.click('offline-'+m);assert.equal(offline.includes(m),false);h.click('offline-start');h.ui.showMenu(x=>offline.push(x),x=>online.push(x));await new Promise(resolve=>setImmediate(resolve));}
  for(const m of ['classic','lastOneStanding','blitz','chaos'])h.click('online-'+m);
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(offline,['classic','blitz','chaos','survival','daily']);assert.deepEqual(online,['classic','lastOneStanding','blitz','chaos']);h.ui.clearMenu();assert.equal(h.classes.has('menu-screen'),false);
});
test('Profile tabs preserve drafts, palette, locale changes and existing progress without writing storage',async()=>{
  const h=harness(),before=JSON.stringify(h.profile);h.ui.showProfile(noop);h.nodes.get('#player-name').value='New Player';h.nodes.get('#edit-profile').open=true;h.nodes.get('color-2').onclick();h.click('tab-records');h.click('ru');assert.ok(h.overlay.innerHTML.includes('Личные рекорды Offline'));assert.equal(h.nodes.get('#player-name').value,'New Player');assert.equal(h.nodes.get('color-2').getAttribute('aria-pressed'),'true');assert.equal(h.nodes.get('#edit-profile').open,true);h.click('tab-achievements');assert.equal((h.overlay.innerHTML.match(/class="achievement-card /g)||[]).length,17);h.click('tab-daily');assert.equal(h.overlay.innerHTML.includes('<table'),false);assert.equal(JSON.stringify(h.profile),before);assert.equal(h.saved(),0);await h.nodes.get('#profile-form').onsubmit({preventDefault:noop});assert.equal(h.profile.name,'New Player');assert.equal(h.profile.color,2);assert.equal(h.saved(),1);
});
test('Leaderboard loads server data without projecting local XP or writing local progress',async()=>{
  const h=harness();h.profile.progression.xp=999999;const before=JSON.stringify(h.profile);h.ui.showLeaderboard(noop);assert.ok(h.overlay.innerHTML.includes('Loading server rankings'));assert.equal(h.overlay.innerHTML.includes('Create account with passkey'),false);await new Promise(resolve=>setImmediate(resolve));assert.ok(h.overlay.innerHTML.includes('Could not load rankings'));assert.equal(JSON.stringify(h.profile),before);assert.equal(h.saved(),0);h.click('back');
});
test('Profile summary uses the Online winning streak rather than the unrelated event streak',()=>{
  const h=harness();h.profile.stats.streak=100;const s=loadModule('uiModel').profileSummary(h.profile);assert.equal(s.bestStreak,2);assert.equal(s.wins,3);assert.equal(s.matches,9);
});
test('Legacy Survival records remain visible; invalid edits and keyboard navigation do not mutate progress',()=>{
  const h=harness();h.profile.offline.survival.bestScore=321;h.profile.offline.survival.bestTime=123;h.profile.offline.survival.bestEvents=12;
  const before=JSON.stringify(h.profile);h.ui.showProfile(noop);h.nodes.get('#tab-stats').onkeydown({key:'ArrowRight',preventDefault:noop});
  assert.ok(h.overlay.innerHTML.includes('<strong>321</strong>'));assert.ok(h.overlay.innerHTML.includes('02:03'));assert.equal(h.nodes.get('#tab-records').getAttribute('aria-selected'),'true');
  h.nodes.get('#player-name').value='x';h.nodes.get('#profile-form').onsubmit({preventDefault:noop});assert.ok(h.nodes.get('#profile-error').textContent);assert.equal(h.saved(),0);assert.equal(JSON.stringify(h.profile),before);
});
