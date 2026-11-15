import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import * as sdk from '@simplewebauthn/server';
import {loadModule} from './load.mjs';
const b64=value=>Buffer.from(value).toString('base64url');
const concat=(...values)=>Buffer.concat(values.map(v=>Buffer.from(v)));
function cbor(v){
 const head=(major,n)=>n<24?Buffer.from([major*32+n]):n<256?Buffer.from([major*32+24,n]):Buffer.from([major*32+25,n>>8,n&255]);
 if(typeof v==='number')return v>=0?head(0,v):head(1,-1-v);
 if(typeof v==='string'){const b=Buffer.from(v);return concat(head(3,b.length),b);}
 if(v instanceof Map)return concat(head(5,v.size),...[...v].flatMap(([k,x])=>[cbor(k),cbor(x)]));
 return concat(head(2,v.length),v);
}
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const migration of ['0001_accounts_ratings.sql','0002_auth_context.sql','0003_settlement.sql','0004_simple_auth.sql'])sql.exec(readFileSync(`migrations/leaderboard/${migration}`,'utf8'));
 const wrap=(query,args=[])=>({bind:(...values)=>wrap(query,values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v)),first:async()=>sql.prepare(query).get(...args)??null,run:async()=>({success:true,meta:sql.prepare(query).run(...args)}),all:async()=>({results:sql.prepare(query).all(...args)})});
 return {sql,db:{prepare:q=>wrap(q),batch:async statements=>{sql.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}}};
}
async function authenticator(options,origin='https://game.example'){
 const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk=await webcrypto.subtle.exportKey('jwk',keys.publicKey),id=webcrypto.getRandomValues(new Uint8Array(32));
 const rpHash=await webcrypto.subtle.digest('SHA-256',Buffer.from(options.rp.id));
 const pub=cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
 const authData=concat(rpHash,[0x45],[0,0,0,0],new Uint8Array(16),[0,32],id,pub);
 return {keys,id:b64(id),registration:{id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(JSON.stringify({type:'webauthn.create',challenge:options.challenge,origin,crossOrigin:false})),attestationObject:b64(cbor(new Map([['fmt','none'],['authData',authData],['attStmt',new Map()]]))),transports:['internal']}}};
}
async function assertion(auth,options,origin='https://game.example',flags=5){
 const data=concat(await webcrypto.subtle.digest('SHA-256',Buffer.from(options.rpId)),[flags],[0,0,0,1]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:options.challenge,origin,crossOrigin:false}));
 const signature=new Uint8Array(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},auth.keys.privateKey,concat(data,await webcrypto.subtle.digest('SHA-256',client))));
 const integer=part=>{let v=Buffer.from(part);while(v.length>1&&v[0]===0)v=v.subarray(1);if(v[0]&128)v=concat([0],v);return concat([2,v.length],v);};
 const der=concat(integer(signature.slice(0,32)),integer(signature.slice(32)));return {id:auth.id,rawId:auth.id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client),authenticatorData:b64(data),signature:b64(concat([0x30,der.length],der))}};
}
function service(){const store=database();let now=1000;const {Accounts}=loadModule('../worker/accounts',{crypto:webcrypto,TextEncoder,Uint8Array,ArrayBuffer,URL},{'@simplewebauthn/server':sdk});return {...store,accounts:new Accounts(store.db,'https://game.example','game.example',()=>now),advance:s=>now+=s};}
test('real SDK verifies registration and ECDSA login; challenge replay, signature and wrong origin fail',async()=>{
 const {accounts,sql}=service();try{
  const reg=await accounts.registration('Alice'),auth=await authenticator(reg.options),created=await accounts.finishRegistration(reg.token,auth.registration);
  assert.match(created.accountId,/^[a-f0-9-]{36}$/);assert.equal(created.recoveryCodes.length,8);assert.equal((await accounts.session(created.sessionToken)).id,created.accountId);
  await assert.rejects(()=>accounts.finishRegistration(reg.token,auth.registration));
  const login=await accounts.login(),response=await assertion(auth,login.options),signed=await accounts.finishLogin(login.token,response);assert.equal(signed.accountId,created.accountId);
  const wrong=await accounts.login(),bad=await assertion(auth,wrong.options);await assert.rejects(()=>accounts.finishLogin(wrong.token,awaitableBad(bad)));
  const origin=await accounts.login();await assert.rejects(async()=>accounts.finishLogin(origin.token,await assertion(auth,origin.options,'https://evil.example')));
  const uv=await accounts.login();await assert.rejects(async()=>accounts.finishLogin(uv.token,await assertion(auth,uv.options,'https://game.example',1)));
 }finally{sql.close();}
});
function awaitableBad(response){return {...response,response:{...response.response,signature:b64(new Uint8Array(64))}};}
test('recovery is one-use, revokes sessions, preserves UUID after new passkey and deletion blocks login',async()=>{
 const {accounts,sql}=service();try{
  const reg=await accounts.registration('Alice'),auth=await authenticator(reg.options),created=await accounts.finishRegistration(reg.token,auth.registration);
  const recovered=await accounts.recover(created.recoveryCodes[0]);assert.equal(await accounts.session(created.sessionToken),null);
  await assert.rejects(()=>accounts.recover(created.recoveryCodes[0]));
  const nextAuth=await authenticator(recovered.options),next=await accounts.finishRegistration(recovered.token,nextAuth.registration);assert.equal(next.accountId,created.accountId);
  const session=await accounts.session(next.sessionToken);await accounts.deleteAccount(session);assert.equal(await accounts.session(next.sessionToken),null);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM credentials').get().n,0);await assert.rejects(()=>accounts.recover(next.recoveryCodes[0]));
 }finally{sql.close();}
});
test('expired challenges and sessions, logout, recent-auth deletion and persistent SQL rate limits',async()=>{
 const {accounts,sql,advance}=service();try{
  const reg=await accounts.registration('Alice'),auth=await authenticator(reg.options);advance(301);await assert.rejects(()=>accounts.finishRegistration(reg.token,auth.registration));
  const fresh=await accounts.registration('Alice'),key=await authenticator(fresh.options),created=await accounts.finishRegistration(fresh.token,key.registration);
  const session=await accounts.session(created.sessionToken);advance(301);await assert.rejects(()=>accounts.deleteAccount(session));await accounts.logout(created.sessionToken);assert.equal(await accounts.session(created.sessionToken),null);
  assert.equal(await accounts.limit('test',1),true);assert.equal(await accounts.limit('test',1),false);advance(61);assert.equal(await accounts.limit('test',1),true);
  const expired=await accounts.registration('Other'),other=await authenticator(expired.options),result=await accounts.finishRegistration(expired.token,other.registration);advance(7*86400+1);assert.equal(await accounts.session(result.sessionToken),null);
 }finally{sql.close();}
});
test('account HTTP API uses real verification, secure cookies and rejects cross-origin and unauthenticated access',async()=>{
 const {sql,db}=database();
 const {accountApi}=loadModule('../worker/accountApi',{crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,Request,Response,Headers},{'@simplewebauthn/server':sdk});
 const env={RANKINGS_DB:db,AUTH_ORIGIN:'https://game.example',AUTH_RP_ID:'game.example'};
 const request=(path,input,cookies='',origin='https://game.example')=>new Request(`https://game.example${path}`,input===undefined?{headers:{Cookie:cookies}}:{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookies},body:JSON.stringify(input)});
 try{
  assert.equal((await accountApi(request('/api/account/me'),env)).status,401);
  const unavailable={...env,RANKINGS_DB:{prepare(){throw new Error('D1 internal failure with sensitive details');}}};
  const outage=await accountApi(request('/api/account/me'),unavailable);assert.equal(outage.status,503);assert.deepEqual(await outage.json(),{error:'serviceUnavailable'});
  assert.equal((await accountApi(request('/api/auth/register/options',{name:'Alice'},'','https://evil.example'),env)).status,403);
  const options=await accountApi(request('/api/auth/register/options',{name:'Alice',accountId:'spoofed'}),env);
  const challenge=options.headers.getSetCookie()[0].split(';')[0],auth=await authenticator(await options.json());
  const verified=await accountApi(request('/api/auth/register/verify',{response:auth.registration},challenge),env);assert.equal(verified.status,200);
  const cookies=verified.headers.getSetCookie();assert.ok(cookies[0].includes('HttpOnly; Secure; SameSite=Strict'));
  const session=cookies[0].split(';')[0],account=await verified.json();assert.notEqual(account.accountId,'spoofed');assert.equal(account.sessionToken,undefined);
  const me=await accountApi(request('/api/account/me',undefined,session),env);assert.equal((await me.json()).accountId,account.accountId);
  const {Rankings}=loadModule('../worker/rankings',{crypto:webcrypto,TextEncoder});
  const other=webcrypto.randomUUID();sql.prepare("INSERT INTO accounts VALUES(?,?,0,'active')").run(other,'Other');
  const now=Math.floor(Date.now()/1000);
  await new Rankings(db).settle({id:webcrypto.randomUUID(),mode:'classic',startedAt:now-60,finishedAt:now,players:[{accountId:account.accountId,placement:1,outcome:'win'},{accountId:other,placement:2,outcome:'loss'}]});
  const rating=await accountApi(request('/api/leaderboard/me?season=lifetime',undefined,session),env);assert.equal(rating.status,200);const data=await rating.json();assert.equal(data.me.accountId,account.accountId);assert.equal(data.me.games,1);assert.equal(data.top.length,2);
  assert.equal((await accountApi(request('/api/leaderboard/me'),env)).status,401);
  await accountApi(request('/api/auth/logout',{},session),env);assert.equal((await accountApi(request('/api/account/me',undefined,session),env)).status,401);
 }finally{sql.close();}
});
test('nickname edit uses session UUID, survives reload and preserves real rating; CSRF and invalid names rejected',async()=>{
 const {accounts,sql,db}=service();try{
  const reg=await accounts.registration('Alice'),auth=await authenticator(reg.options),created=await accounts.finishRegistration(reg.token,auth.registration);
  sql.prepare('UPDATE sessions SET expires_at=?,reauthenticated_at=?').run(Math.floor(Date.now()/1000)+3600,Math.floor(Date.now()/1000));
  sql.prepare("INSERT INTO ratings(account_id,mode,season_id,value,games,wins) VALUES(?,'overall','lifetime',1050,1,1)").run(created.accountId);
  const {accountApi}=loadModule('../worker/accountApi',{crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,Request,Response,Headers},{'@simplewebauthn/server':sdk});
  const env={RANKINGS_DB:db,AUTH_ORIGIN:'https://game.example',AUTH_RP_ID:'game.example'};
  const req=(path,input,origin='https://game.example')=>new Request('https://game.example'+path,{method:input?'POST':'GET',headers:{Origin:origin,Cookie:'__Host-ruleshift-session='+created.sessionToken,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
  assert.equal((await accountApi(req('/api/account/nickname',{name:'Admin'}),env)).status,400);
  assert.equal((await accountApi(req('/api/account/nickname',{name:'Bobby'},'https://evil.example'),env)).status,403);
  const renamed=await accountApi(req('/api/account/nickname',{name:'  Новый   ник ' }),env);assert.equal(renamed.status,200);assert.equal((await renamed.json()).accountId,created.accountId);
  assert.equal((await (await accountApi(req('/api/account/me'),env)).json()).name,'Новый ник');
  const table=await (await accountApi(req('/api/leaderboard?season=lifetime'),env)).json();assert.equal(table.top[0].name,'Новый ник');assert.equal(table.top[0].points,1050);assert.equal(sql.prepare('SELECT COUNT(*) n FROM accounts').get().n,1);
 }finally{sql.close();}
});
