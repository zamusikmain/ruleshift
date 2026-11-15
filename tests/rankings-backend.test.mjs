import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {loadModule} from './load.mjs';
const {Rankings,utcSeason}=loadModule('../worker/rankings',{crypto:webcrypto,TextEncoder});
const {RoomRankings}=loadModule('../worker/roomRankings',{crypto:webcrypto,TextEncoder});
const ids=[webcrypto.randomUUID(),webcrypto.randomUUID()];
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync('migrations/leaderboard').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/leaderboard/'+file,'utf8'));
 const wrap=(q,args=[])=>({bind:(...v)=>wrap(q,v),first:async()=>sql.prepare(q).get(...args)??null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>({success:true,meta:sql.prepare(q).run(...args)})});
 // Serialize SQLite adapter batches; D1 batch provides the runtime transaction.
 let queue=Promise.resolve();const db={prepare:q=>wrap(q),batch:stmts=>{const result=queue.then(async()=>{sql.exec('BEGIN');try{const values=[];for(const s of stmts)values.push(await s.run());sql.exec('COMMIT');return values;}catch(e){sql.exec('ROLLBACK');throw e;}});queue=result.catch(()=>{});return result;}};
 ids.forEach((id,i)=>sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(id,'Player'+i,0,'active'));
 return {sql,db,rankings:new Rankings(db)};
}
const receipt=(extra={})=>({id:webcrypto.randomUUID(),mode:'classic',startedAt:Date.UTC(2026,9,1)/1000,finishedAt:Date.UTC(2026,9,1)/1000+90,players:ids.map((accountId,i)=>({accountId,placement:i+1,outcome:i?'loss':'win'})),...extra});
test('atomic settlement, duplicate delivery and conflicting receipt',async()=>{
 const {sql,rankings}=database();try{const r=receipt();await Promise.all([rankings.settle(r),rankings.settle(r)]);assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches').get().n,1);const table=await rankings.table('overall','2026-10',ids[0]);assert.equal(table.top.length,2);assert.equal(table.me.games,1);assert.equal(table.me.points,1006);assert.equal(table.me.place,1);await assert.rejects(()=>rankings.settle({...r,mode:'chaos'}));assert.equal(sql.prepare('SELECT COUNT(*) n FROM settlement_guard').get().n,0);}finally{sql.close();}
});
test('concurrent different matches retry revisions; pair farming is capped',async()=>{
 const {sql,rankings}=database();try{await Promise.all([rankings.settle(receipt()),rankings.settle(receipt())]);await rankings.settle(receipt());const before=(await rankings.table('overall','lifetime',ids[0])).me.points;await rankings.settle(receipt());const after=(await rankings.table('overall','lifetime',ids[0])).me;assert.equal(after.points,before);assert.equal(after.games,4);assert.equal(after.streak,4);assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches').get().n,4);}finally{sql.close();}
});
test('reverse outbox delivery cannot bypass the repeated-pair cap',async()=>{
 const {sql,rankings}=database();try{
  const base=Date.UTC(2026,9,1)/1000;
  for(let i=4;i>=1;i--)await rankings.settle(receipt({startedAt:base,finishedAt:base+i*90}));
  const match=sql.prepare('SELECT id FROM matches ORDER BY finished_at LIMIT 1').get();
  assert.equal(sql.prepare("SELECT delta FROM settlement_ledger WHERE match_id=? AND account_id=? AND mode='overall' AND season_id='lifetime'").get(match.id,ids[0]).delta,0);
 }finally{sql.close();}
});
test('UTC seasons, draws, forfeits, mode filters and deleted accounts',async()=>{
 const {sql,rankings}=database();try{assert.equal(utcSeason(Date.UTC(2026,11,31,23,59,59)/1000).id,'2026-12');assert.equal(utcSeason(Date.UTC(2027,0,1)/1000).id,'2027-01');await rankings.settle(receipt({mode:'blitz',players:ids.map(accountId=>({accountId,placement:1,outcome:'draw'}))}));assert.equal((await rankings.table('blitz','lifetime',ids[0])).me.draws,1);assert.equal((await rankings.table('chaos','lifetime')).top.length,0);sql.prepare("UPDATE accounts SET status='deleted' WHERE id=?").run(ids[1]);await rankings.settle(receipt());assert.equal(sql.prepare("SELECT COUNT(*) n FROM matches WHERE status='void'").get().n,1);assert.equal((await rankings.table('overall','lifetime',ids[0])).me.games,1);await assert.rejects(()=>rankings.table('bad','lifetime'));assert.equal((await rankings.seasons()).length,1);}finally{sql.close();}
});
test('durable outbox survives transient failure and restart; rematch gets a new UUID',async()=>{
 const {sql,db}=database(),values=new Map();let alarms=0;
 const storage={get:async k=>values.get(k),put:async(k,v)=>{if(typeof k==='object'){for(const [key,value] of Object.entries(k))values.set(key,structuredClone(value));}else values.set(k,structuredClone(v));},delete:async k=>values.delete(k),list:async({prefix})=>new Map([...values].filter(([k])=>k.startsWith(prefix))),setAlarm:async()=>alarms++};
 const room={phase:'countdown',matchId:1,mode:'classic',winnerId:'p0',members:new Map(ids.map((id,i)=>['p'+i,{state:{id:'p'+i,placement:i+1,score:10-i,forfeited:false}}]))},principals=new Map(ids.map((id,i)=>['p'+i,id]));
 const outbox=new RoomRankings(storage,db);await outbox.capture(room,principals);room.phase='results';await outbox.capture(room,principals);assert.equal(alarms,1);
 const broken=new RoomRankings(storage,{...db,batch:async()=>{throw Error('temporary');}});assert.equal(await broken.deliver(),false);assert.equal([...values.keys()].filter(k=>k.startsWith('outbox:')).length,1);
 const restarted=new RoomRankings(storage,db);assert.equal(await restarted.deliver(),true);assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches').get().n,1);
 room.phase='countdown';room.matchId=2;await restarted.capture(room,principals);room.phase='results';await restarted.capture(room,principals);await restarted.deliver();assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches').get().n,2);sql.close();
});
test('restart journals an interrupted match without rating; completed outbox is never voided',async()=>{
 const {sql,db}=database(),values=new Map(),storage={get:async k=>values.get(k),put:async(k,v)=>{if(typeof k==='object'){for(const [key,value] of Object.entries(k))values.set(key,structuredClone(value));}else values.set(k,structuredClone(v));},delete:async k=>values.delete(k),list:async({prefix})=>new Map([...values].filter(([k])=>k.startsWith(prefix))),setAlarm:async()=>{}};
 const room={phase:'countdown',matchId:1,mode:'classic',members:new Map(ids.map((id,i)=>['p'+i,{state:{id:'p'+i}}]))};
 const outbox=new RoomRankings(storage,db);await outbox.capture(room,new Map(ids.map((id,i)=>['p'+i,id])));
 const start=values.get('ranked-start');await new RoomRankings(storage,db).interrupt();await new RoomRankings(storage,db).interrupt();assert.equal(values.get('interrupted:'+start.id).status,'interrupted');await outbox.deliver();assert.equal(sql.prepare('SELECT COUNT(*) n FROM ratings').get().n,0);
 const completed=receipt();values.set('ranked-start',{id:completed.id});values.set('outbox:'+completed.id,completed);const restarted=new RoomRankings(storage,db);await restarted.interrupt();assert.equal(values.has('interrupted:'+completed.id),false);await restarted.deliver();await restarted.deliver();assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches').get().n,1);sql.close();
});
test('deleted account in pending outbox is void exactly once and never resurrects ratings',async()=>{
 const {sql,db}=database(),r=receipt(),values=new Map([['outbox:'+r.id,r]]),storage={list:async()=>new Map(values),delete:async k=>values.delete(k)};
 sql.prepare("UPDATE accounts SET status='deleted',display_name='Deleted' WHERE id=?").run(ids[1]);const outbox=new RoomRankings(storage,db);assert.equal(await outbox.deliver(),true);assert.equal(await outbox.deliver(),true);assert.equal(sql.prepare("SELECT COUNT(*) n FROM matches WHERE status='void'").get().n,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM ratings').get().n,0);sql.close();
});
test('retry after alarm failure preserves the exact completed receipt',async()=>{
 const {sql,db}=database(),values=new Map();let fail=false;
 const storage={get:async k=>values.get(k),put:async(k,v)=>{if(typeof k==='object'){for(const [key,value] of Object.entries(k))values.set(key,structuredClone(value));}else values.set(k,structuredClone(v));},delete:async k=>values.delete(k),list:async({prefix})=>new Map([...values].filter(([k])=>k.startsWith(prefix))),setAlarm:async()=>{if(fail)throw Error('alarm unavailable');}};
 const room={phase:'countdown',matchId:1,mode:'classic',winnerId:'p0',members:new Map(ids.map((id,i)=>['p'+i,{state:{id:'p'+i,placement:i+1,score:10-i}}]))},principals=new Map(ids.map((id,i)=>['p'+i,id]));
 const outbox=new RoomRankings(storage,db);await outbox.capture(room,principals);room.phase='results';fail=true;await assert.rejects(()=>outbox.capture(room,principals));const key=[...values.keys()].find(k=>k.startsWith('outbox:')),saved=JSON.stringify(values.get(key));room.members.get('p0').state.score=999;fail=false;await outbox.capture(room,principals);assert.equal(JSON.stringify(values.get(key)),saved);await outbox.deliver();assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches').get().n,1);values.set('ranked-start',{id:key.slice(7)});await new RoomRankings(storage,db).interrupt();assert.equal(values.has('interrupted:'+key.slice(7)),false);sql.close();
});
test('top 100 is bounded and returns own rank outside the first page',async()=>{
 const {sql,rankings}=database();try{let last;
  for(let i=0;i<105;i++){const id=webcrypto.randomUUID();last=id;sql.prepare("INSERT INTO accounts VALUES(?,?,0,'active')").run(id,'User'+i);sql.prepare("INSERT INTO ratings(account_id,mode,season_id,value,games,wins,losses) VALUES(?,'overall','lifetime',?,1,1,0)").run(id,2000-i);}
  const data=await rankings.table('overall','lifetime',last);assert.equal(data.top.length,100);assert.equal(data.me.place,105);
 }finally{sql.close();}
});
test('eight-player server room captures actual forfeits, reconnect and rematch without browser receipts',async()=>{
 const {sql,db}=database(),{Room}=loadModule('shared/room',{crypto:webcrypto}),room=new Room('ABC234',()=>.5),values=new Map(),principals=new Map();
 const storage={get:async k=>values.get(k),put:async(k,v)=>{if(typeof k==='object'){for(const [key,value] of Object.entries(k))values.set(key,structuredClone(value));}else values.set(k,structuredClone(v));},delete:async k=>values.delete(k),list:async({prefix})=>new Map([...values].filter(([k])=>k.startsWith(prefix))),setAlarm:async()=>{}};
 const outbox=new RoomRankings(storage,db);
 for(let i=0;i<8;i++){const id=i<2?ids[i]:webcrypto.randomUUID();if(i>=2)sql.prepare("INSERT INTO accounts VALUES(?,?,0,'active')").run(id,'User'+i);principals.set('p'+i,id);room.join('p'+i,'token'+i,'Player'+i,i);room.command('p'+i,{type:'ready',ready:true});}
 room.command('p0',{type:'start'});await outbox.capture(room,principals);room.tick(3.1);
 room.disconnect('p1');const rejoined=room.join('unused','unused','Player1',1,'token1');assert.equal(rejoined.id,'p1');
 for(let i=1;i<8;i++)room.command('p'+i,{type:'leave'});
 assert.equal(room.phase,'results');await outbox.capture(room,principals);await outbox.deliver();assert.equal(sql.prepare("SELECT COUNT(*) n FROM participants WHERE outcome='forfeit'").get().n,7);assert.equal((await new Rankings(db).table('overall','lifetime',ids[0])).me.wins,1);await outbox.capture(room,principals);await outbox.deliver();assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches').get().n,1);sql.close();
});



test('outbox retries a committed receipt after lost acknowledgement without a second rating',async()=>{
 const {sql,db}=database(),r=receipt(),values=new Map([['outbox:'+r.id,r]]);let failDelete=true;
 const storage={list:async()=>new Map(values),delete:async key=>{if(failDelete)throw Error('ack lost');values.delete(key);}};
 try{
  assert.equal(await new RoomRankings(storage,db).deliver(),false);
  assert.equal(values.size,1);
  const before=sql.prepare('SELECT * FROM ratings ORDER BY account_id,mode,season_id').all();
  failDelete=false;
  assert.equal(await new RoomRankings(storage,db).deliver(),true);
  assert.equal(values.size,0);
  assert.deepEqual(sql.prepare('SELECT * FROM ratings ORDER BY account_id,mode,season_id').all(),before);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM matches').get().n,1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM settlement_ledger').get().n,8);
 }finally{sql.close();}
});
