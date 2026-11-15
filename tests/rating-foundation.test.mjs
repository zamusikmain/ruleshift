import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {loadModule} from './load.mjs';
const {ratingDeltas}=loadModule('shared/rating');
test('candidate rating is zero-sum for 2–8 participants, draws, forfeits and every pair-cap step',()=>{
 for(let n=2;n<=8;n++) for(let repeat=0;repeat<5;repeat++) for(let forfeit=0;forfeit<2;forfeit++) {
  const players=Array.from({length:n},(_,i)=>({accountId:`a${i}`,rating:900+i*80,placement:i===0?1:2,forfeited:!!forfeit&&i===0}));
  const deltas=ratingDeltas(players,()=>repeat);assert.ok(Math.abs([...deltas.values()].reduce((a,b)=>a+b,0))<1e-10);
  if(repeat>=3) assert.ok([...deltas.values()].every(v=>v===0));
 }
 const players=[{accountId:'a',rating:1000,placement:1,forfeited:false},{accountId:'b',rating:1000,placement:1,forfeited:false}];
 assert.equal(ratingDeltas(players,()=>0).get('a'),0);players[1].placement=2;
 assert.equal(ratingDeltas(players,()=>0).get('a'),6);assert.equal(ratingDeltas(players,()=>1).get('a'),3);
 assert.throws(()=>ratingDeltas([players[0],players[0]],()=>0));assert.throws(()=>ratingDeltas(players,()=>-1));
});
test('local SQLite migration creates empty schema, enforces ledger uniqueness and rolls back failed settlement',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  db.exec('PRAGMA foreign_keys=ON');db.exec(readFileSync('migrations/leaderboard/0001_accounts_ratings.sql','utf8'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ratings').get().n,0);
  db.exec("INSERT INTO accounts VALUES ('a','Alice',0,'active'); INSERT INTO seasons VALUES ('2026-10',0,100,'open'); INSERT INTO matches VALUES ('m','classic','2026-10',0,10,1,'hash','settled'); INSERT INTO ratings(account_id,mode,season_id) VALUES ('a','overall','lifetime')");
  const insert=db.prepare("INSERT INTO settlement_ledger VALUES ('m','a','overall','lifetime',6)");insert.run();
  db.exec('BEGIN');db.exec("UPDATE ratings SET value=1006 WHERE account_id='a'");
  assert.throws(()=>insert.run());db.exec('ROLLBACK');
  assert.equal(db.prepare('SELECT value FROM ratings').get().value,1000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM settlement_ledger').get().n,1);
  assert.throws(()=>db.exec("INSERT INTO participants VALUES ('m','unknown','win',1)"));
 } finally {db.close();}
});
