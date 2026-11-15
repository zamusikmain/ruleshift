import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import * as jose from 'jose';
import * as sdk from '@simplewebauthn/server';
import {loadModule} from './load.mjs';
const globals={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,URLSearchParams,AbortSignal,fetch,btoa};
const {SimpleAuth,googleSubject,normalizeEmail}=loadModule('../worker/simpleAuth',globals,{jose,'@simplewebauthn/server':sdk});
const {Accounts}=loadModule('../worker/accounts',globals,{'@simplewebauthn/server':sdk});
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync('migrations/leaderboard').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/leaderboard/'+file,'utf8'));
 const stmt=(q,args=[])=>({bind:(...a)=>stmt(q,a),first:async()=>sql.prepare(q).get(...args)??null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>({success:true,meta:sql.prepare(q).run(...args)})});
 const db={prepare:q=>stmt(q),batch:async ss=>{sql.exec('BEGIN');try{for(const s of ss)await s.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
 let now=1000,code;const accounts=new Accounts(db,'https://game.example','game.example',()=>now);
 const auth=new SimpleAuth(accounts,{RESEND_API_KEY:'test-only',EMAIL_FROM:'test@example.com',AUTH_CODE_SECRET:'test-only-hmac-secret-longer-than-32'},async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');code=JSON.parse(init.body).text.match(/\d{6}/)[0];return new Response('{}',{status:200});});
 return {sql,accounts,auth,code:()=>code,advance:n=>now+=n};
}

test('own profile exposes linked methods without subjects or secrets; rename preserves identity',async()=>{
 const f=fixture();try{
  const flow=await f.auth.emailStart('private@example.com','Tester',false,undefined,'en');
  const result=await f.auth.emailFinish(flow,f.code());
  f.sql.prepare('UPDATE sessions SET expires_at=?').run(Math.floor(Date.now()/1000)+600);
  const {accountApi}=loadModule('../worker/accountApi',{...globals,Request,Response,Headers},{jose,'@simplewebauthn/server':sdk});
  const env={RANKINGS_DB:f.accounts.db,AUTH_ORIGIN:'https://game.example',AUTH_RP_ID:'game.example'};
  const headers={Cookie:'__Host-ruleshift-session='+result.sessionToken};
  const me=await accountApi(new Request('https://game.example/api/account/me',{headers}),env);
  const data=await me.json();assert.equal(me.status,200);assert.deepEqual(data.methods,['email']);assert.equal(data.accountId,result.accountId);assert.equal(JSON.stringify(data).includes('private@example.com'),false);
  const renamed=await accountApi(new Request('https://game.example/api/account/nickname',{method:'POST',headers:{...headers,Origin:'https://game.example','Content-Type':'application/json'},body:JSON.stringify({name:'New Player'})}),env);
  assert.equal(renamed.status,200);assert.equal((await renamed.json()).accountId,result.accountId);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM accounts').get().n,1);
  const denied=await accountApi(new Request('https://game.example/api/account/me'),env);assert.equal(denied.status,401);
 }finally{f.sql.close();}
});
test('Resend OTP creates persistent identity and session; hashed storage, replay and expiry rejected',async()=>{
 const f=fixture();try{
  const flow=await f.auth.emailStart('TEST@example.com','Tester',false,undefined,'en'),code=f.code();
  const row=f.sql.prepare('SELECT * FROM login_flows').get();assert.notEqual(row.code_hash,code);assert.ok(!row.context.includes(code));
  const result=await f.auth.emailFinish(flow,code);assert.equal((await f.accounts.session(result.sessionToken)).id,result.accountId);
  await assert.rejects(()=>f.auth.emailFinish(flow,code));
  const next=await f.auth.emailStart('test@example.com','Other',false,undefined,'ru');assert.equal((await f.auth.emailFinish(next,f.code())).accountId,result.accountId);
  const expired=await f.auth.emailStart('new@example.com','Tester',false,undefined,'en');f.advance(301);await assert.rejects(()=>f.auth.emailFinish(expired,f.code()));
 }finally{f.sql.close();}
});
test('OTP attempt budget, disabled provider and revoked account-link proof fail closed',async()=>{
 const f=fixture();try{
  await assert.rejects(()=>new SimpleAuth(f.accounts,{},()=>{throw Error('must not send');}).emailStart('test@example.com','Test',false,undefined,'en'));
  const flow=await f.auth.emailStart('test@example.com','Test',false,undefined,'en'),valid=f.code(),wrong=valid==='000000'?'111111':'000000';for(let n=0;n<5;n++)await assert.rejects(()=>f.auth.emailFinish(flow,wrong));await assert.rejects(()=>f.auth.emailFinish(flow,valid));
  const first=await f.auth.emailStart('other@example.com','Test',false,undefined,'en');const signed=await f.auth.emailFinish(first,f.code());
  const linked=await f.auth.emailStart('link@example.com','Test',true,signed.sessionToken,'en');await f.accounts.logout(signed.sessionToken);await assert.rejects(()=>f.auth.emailFinish(linked,f.code()));assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM auth_identities WHERE subject='link@example.com'").get().n,0);
 }finally{f.sql.close();}
});
test('Google JWT checks actual RSA signature, issuer, audience, nonce and expiry',async()=>{
 const {privateKey,publicKey}=await jose.generateKeyPair('RS256');const token=await new jose.SignJWT({nonce:'nonce'}).setProtectedHeader({alg:'RS256'}).setIssuer('https://accounts.google.com').setAudience('client').setSubject('google-sub').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 assert.equal(await googleSubject(token,'client','nonce',async()=>publicKey),'google-sub');
 await assert.rejects(()=>googleSubject(token,'wrong','nonce',async()=>publicKey));await assert.rejects(()=>googleSubject(token,'client','wrong',async()=>publicKey));
 const other=await jose.generateKeyPair('RS256');await assert.rejects(()=>googleSubject(token,'client','nonce',async()=>other.publicKey));
 assert.equal(normalizeEmail(' Test@Example.com '),'test@example.com');assert.equal(normalizeEmail('invalid'),null);
});
test('nickname policy normalizes spacing and rejects markup and impersonation',()=>{
 const {validateNickname}=loadModule('shared/identity');assert.equal(validateNickname('  Zamir   2  '),'Zamir 2');assert.equal(validateNickname('Игрок_2'),'Игрок_2');for(const name of ['Admin','RULESHIFT','модератор','<script>','x'])assert.equal(validateNickname(name),null);
});
test('Google flow contains PKCE and nonce; wrong or expired state never reaches token exchange',async()=>{
 const f=fixture();try{
  let exchanges=0;const auth=new SimpleAuth(f.accounts,{GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-only'},async()=>{exchanges++;throw Error('must not exchange');});
  const started=await auth.googleStart('',false,undefined),url=new URL(started.url),context=JSON.parse(f.sql.prepare('SELECT context FROM login_flows').get().context);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('nonce'),context.nonce);const digest=await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(context.verifier));assert.equal(url.searchParams.get('code_challenge'),Buffer.from(digest).toString('base64url'));
  await assert.rejects(()=>auth.googleFinish(started.token,'0'.repeat(64),'code'));assert.equal(exchanges,0);f.advance(301);await assert.rejects(()=>auth.googleFinish(started.token,url.searchParams.get('state'),'code'));assert.equal(exchanges,0);
 }finally{f.sql.close();}
});
test('linking requires proof of both identities and never merges two existing UUIDs',async()=>{
 const f=fixture();try{
  const a=await f.auth.emailStart('a@example.com','Alpha',false,undefined,'en'),first=await f.auth.emailFinish(a,f.code());
  const b=await f.auth.emailStart('b@example.com','Bravo',false,undefined,'en'),second=await f.auth.emailFinish(b,f.code());assert.notEqual(first.accountId,second.accountId);
  const conflict=await f.auth.emailStart('b@example.com','Alpha',true,first.sessionToken,'en');await assert.rejects(()=>f.auth.emailFinish(conflict,f.code()));
  const linked=await f.auth.emailStart('a@example.com','Alpha',true,first.sessionToken,'en'),result=await f.auth.emailFinish(linked,f.code());assert.equal(result.accountId,first.accountId);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM accounts').get().n,2);
 }finally{f.sql.close();}
});

test('Google failure diagnostics distinguish cookie, state, expiry, replay and upstream rejection without secrets',async()=>{
 const f=fixture();try{
  let exchanges=0;
  const auth=new SimpleAuth(f.accounts,{GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret'},async()=>{exchanges++;return new Response(JSON.stringify({error:'invalid_client',error_description:'DO NOT LOG test-secret'}),{status:401});});
  const flow=await auth.googleStart('Tester',false),state=new URL(flow.url).searchParams.get('state');
  const rejected=reason=>error=>error.reason===reason&&!error.message.includes('test-secret');
  await assert.rejects(()=>auth.googleFinish('',state,'code'),rejected('oauth_cookie_missing'));
  await assert.rejects(()=>auth.googleFinish(flow.token,'0'.repeat(64),'code'),rejected('state_mismatch'));
  assert.equal(exchanges,0);
  await assert.rejects(()=>auth.googleFinish(flow.token,state,'code'),error=>error.reason==='token_exchange_invalid_client'&&error.upstreamStatus===401);
  await assert.rejects(()=>auth.googleFinish(flow.token,state,'code'),rejected('flow_missing_or_replayed'));assert.equal(exchanges,1);
  const expired=await auth.googleStart('Tester',false);f.advance(301);
  await assert.rejects(()=>auth.googleFinish(expired.token,new URL(expired.url).searchParams.get('state'),'code'),rejected('flow_expired'));assert.equal(exchanges,1);
 }finally{f.sql.close();}
});

test('complete Google code exchange verifies RSA token, PKCE, stores a session and preserves UUID on another login',async()=>{
 const f=fixture();try{
  const {privateKey,publicKey}=await jose.generateKeyPair('RS256');
  const {SimpleAuth:GoogleAuth}=loadModule('../worker/simpleAuth',globals,{jose:{...jose,createRemoteJWKSet:()=>async()=>publicKey},'@simplewebauthn/server':sdk});
  let nonce,verifier,exchanges=0;
  const auth=new GoogleAuth(f.accounts,{GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret'},async(url,init)=>{
   exchanges++;assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(init.method,'POST');
   const body=new URLSearchParams(init.body);assert.equal(body.get('redirect_uri'),'https://game.example/api/auth/google/callback');assert.equal(body.get('code_verifier'),verifier);assert.equal(body.get('client_id'),'test-client');assert.equal(body.get('client_secret'),'test-secret');assert.equal(body.get('grant_type'),'authorization_code');
   const id_token=await new jose.SignJWT({nonce,azp:'test-client'}).setProtectedHeader({alg:'RS256'}).setIssuer('https://accounts.google.com').setAudience('test-client').setSubject('real-signature-test-subject').setIssuedAt().setExpirationTime('5m').sign(privateKey);
   return new Response(JSON.stringify({id_token}),{status:200});
  });
  async function login(name){const flow=await auth.googleStart(name,false);const context=JSON.parse(f.sql.prepare('SELECT context FROM login_flows').get().context);nonce=context.nonce;verifier=context.verifier;return auth.googleFinish(flow.token,new URL(flow.url).searchParams.get('state'),'one-time-test-code');}
  const first=await login('Tester');assert.equal((await f.accounts.session(first.sessionToken)).id,first.accountId);
  const second=await login('Other');assert.equal(second.accountId,first.accountId);assert.equal((await f.accounts.session(second.sessionToken)).display_name,'Tester');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM accounts').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM auth_identities').get().n,1);assert.equal(exchanges,2);
  await f.accounts.logout(first.sessionToken);assert.equal(await f.accounts.session(first.sessionToken),null);assert.ok(await f.accounts.session(second.sessionToken));
 }finally{f.sql.close();}
});

test('callback rejects malformed or denied OAuth with 303 and logs only fixed labels',async()=>{
 const f=fixture();try{
  const logs=[];
  const {accountApi}=loadModule('../worker/accountApi',{...globals,Request,Response,Headers,console:{warn:value=>logs.push(JSON.parse(value))}},{jose,'@simplewebauthn/server':sdk});
  const env={RANKINGS_DB:f.accounts.db,AUTH_ORIGIN:'https://game.example',AUTH_RP_ID:'game.example'};
  for(const suffix of ['?state=PRIVATE_STATE&code=a&code=b','?error=access_denied&error_description=PRIVATE_PROVIDER_BODY']){
   const response=await accountApi(new Request('https://game.example/api/auth/google/callback'+suffix),env);
   assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/?auth=failed#account');
   const cookie=response.headers.get('Set-Cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Lax; Max-Age=0/);assert.ok(!cookie.includes('__Host-ruleshift-session'));
  }
  assert.deepEqual(logs.map(l=>l.reason),['callback_invalid','provider_denied']);
  assert.ok(!JSON.stringify(logs).includes('PRIVATE_'));assert.ok(logs.every(l=>l.responseStatus===303));
 }finally{f.sql.close();}
});

test('ambient Worker fetch is called with a legal receiver for Google and Resend',async()=>{
 const f=fixture();try{
  const requests=[];
  // Model workerd's documented host-function receiver check, absent in Node fetch.
  async function ambientFetch(url){
   if(this!==undefined&&this?.fetch!==ambientFetch)throw new TypeError('Illegal invocation: incorrect this reference');
   requests.push(url);
   return url==='https://oauth2.googleapis.com/token'?new Response('{"error":"invalid_grant"}',{status:400}):new Response('{}',{status:200});
  }
  const {SimpleAuth:WorkerAuth}=loadModule('../worker/simpleAuth',{...globals,fetch:ambientFetch},{jose,'@simplewebauthn/server':sdk});
  const auth=new WorkerAuth(f.accounts,{GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-only',RESEND_API_KEY:'test-only',EMAIL_FROM:'test@example.com',AUTH_CODE_SECRET:'test-only-hmac-secret-longer-than-32'});
  const flow=await auth.googleStart('Tester',false);
  await assert.rejects(()=>auth.googleFinish(flow.token,new URL(flow.url).searchParams.get('state'),'test-code'),error=>error.reason==='token_exchange_invalid_grant');
  assert.ok(await auth.emailStart('test@example.com','Tester',false,undefined,'en'));
  assert.deepEqual(requests,['https://oauth2.googleapis.com/token','https://api.resend.com/emails']);
 }finally{f.sql.close();}
});
