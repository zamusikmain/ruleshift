import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';
const {RuleEngine}=loadModule('shared/ruleEngine');
const {modeRules}=loadModule('shared/modes');
const {createBody}=loadModule('shared/movement');
const rng={pick:v=>v[0],between:min=>min,shuffle:v=>v};
for(const [id,deadline] of [[2,4],[9,3.7]]) test(`Blitz objective ${id} checks before awarding survival`,()=>{
 const p={...createBody(100,100),id:'p'},e=new RuleEngine(rng,'blitz');
 e.state.phase='announce';e.state.ids=[id];e.state.remaining=0;
 let hits=0,rewards=0;
 e.update(.01,0,[p],()=>hits++,()=>rewards++);
 assert.ok(e.state.duration>deadline);
 for(let i=0;i<100 && e.state.phase==='active';i++) e.update(.05,i*.05,[p],()=>hits++,()=>rewards++);
 assert.equal(hits,1);assert.equal(rewards,0);assert.equal(e.state.phase,'rest');
});
test('Blitz freeze objective retains its entire movement-check window',()=>{
 const e=new RuleEngine(rng,'blitz'),p={...createBody(),id:'p'};
 e.state.phase='announce';e.state.ids=[4];e.state.remaining=0;e.update(.01,0,[p],()=>{},()=>{});
 assert.ok(e.state.duration>3.8);
});
test('active start reduces idle rest without reducing reaction announcements',()=>{
 assert.equal(modeRules('classic').rest,.7);assert.equal(modeRules('classic').announce,1.5);
 assert.equal(modeRules('blitz').rest,.2);assert.equal(modeRules('blitz').announce,.75);
 assert.equal(modeRules('chaos').rest,.2);assert.equal(modeRules('chaos').announce,.9);
 assert.equal(modeRules('daily').rest,1.2);
});
