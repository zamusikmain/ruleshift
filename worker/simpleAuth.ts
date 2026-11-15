import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';
import {Accounts,hashSecret,randomSecret,SESSION_SECONDS} from './accounts';
import {AuthFailure,OAuthFailure} from './authFailure';
import {validateNickname} from '../src/shared/identity';

export interface SimpleAuthEnv {
 GOOGLE_CLIENT_ID?:string; GOOGLE_CLIENT_SECRET?:string;
 RESEND_API_KEY?:string; EMAIL_FROM?:string; AUTH_CODE_SECRET?:string;
}
interface Context {subject?:string;name:string;accountId?:string;sessionHash?:string;stateHash?:string;nonce?:string;verifier?:string}
interface Flow {context:string;code_hash:string|null;attempts:number}
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export async function googleSubject(token:string,audience:string,nonce:string,keys:JWTVerifyGetKey=googleKeys):Promise<string>{
 const {payload}=await jwtVerify(token,keys,{issuer:['https://accounts.google.com','accounts.google.com'],audience,algorithms:['RS256'],maxTokenAge:'10m',clockTolerance:5});
 if(payload.nonce!==nonce)throw new OAuthFailure('nonce_mismatch');
 if(typeof payload.sub!=='string' || !payload.sub || payload.sub.length>255 || typeof payload.exp!=='number' || typeof payload.iat!=='number' || payload.azp!==undefined&&payload.azp!==audience)throw new OAuthFailure('id_token_claims');
 return payload.sub;
}
export function normalizeEmail(value:unknown):string|null {
 if(typeof value!=='string')return null;
 const email=value.trim().toLowerCase();
 return email.length<=254&&/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email)?email:null;
}
function otp():string {const limit=4294000000;let n:number;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=limit);return String(n%1000000).padStart(6,'0');}
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export class SimpleAuth {
 constructor(readonly accounts:Accounts,readonly env:SimpleAuthEnv,readonly send:typeof fetch=(input,init)=>fetch(input,init)){}
 private stmt(sql:string,...args:(string|number|null)[]){return this.accounts.db.prepare(sql).bind(...args);}
 private async context(name:unknown,link:boolean,sessionToken:string|undefined):Promise<Context>{
  const context:Context={name:validateNickname(name)??'Player'};
  if(link){const session=await this.accounts.session(sessionToken);if(!session||this.accounts.clock()-session.reauthenticated_at>300)throw new AuthFailure('Recent authentication required');context.accountId=session.id;context.sessionHash=await hashSecret(sessionToken!);}
  return context;
 }
 private async save(purpose:'google'|'email',context:Context,codeHash:string|null=null,token=randomSecret()):Promise<string>{
  await this.stmt('DELETE FROM login_flows WHERE expires_at<=?',this.accounts.clock()).run();
  await this.stmt('INSERT INTO login_flows(id_hash,purpose,context,code_hash,expires_at) VALUES(?,?,?,?,?)',await hashSecret(token),purpose,JSON.stringify(context),codeHash,this.accounts.clock()+300).run();return token;
 }
 private async principal(context:Context):Promise<void>{
  if(context.accountId&&!await this.stmt("SELECT s.account_id FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.account_id=? AND s.expires_at>? AND a.status='active'",context.sessionHash??'',context.accountId,this.accounts.clock()).first())throw new AuthFailure('Authentication failed');
 }
 private async identity(provider:'google'|'email',subject:string,context:Context){
  await this.principal(context);
  const found=await this.stmt("SELECT i.account_id FROM auth_identities i JOIN accounts a ON a.id=i.account_id WHERE i.provider=? AND i.subject=? AND a.status='active'",provider,subject).first<{account_id:string}>();
  if(context.accountId){const existing=await this.stmt('SELECT subject FROM auth_identities WHERE account_id=? AND provider=?',context.accountId,provider).first<{subject:string}>();if(existing&&existing.subject!==subject)throw new AuthFailure('Provider already linked');}
  if(found&&context.accountId&&found.account_id!==context.accountId)throw new AuthFailure('Identity already linked');
  const accountId=found?.account_id??context.accountId??crypto.randomUUID(),token=randomSecret(),now=this.accounts.clock();
  const statements:D1PreparedStatement[]=[];
  if(!found){
   if(!context.accountId)statements.push(this.stmt("INSERT INTO accounts(id,display_name,created_at) VALUES(?,?,?)",accountId,context.name,now));
   statements.push(context.accountId?this.stmt("INSERT INTO auth_identities(provider,subject,account_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND account_id=? AND expires_at>?)",provider,subject,accountId,context.sessionHash??'',accountId,now):this.stmt('INSERT INTO auth_identities(provider,subject,account_id) VALUES(?,?,?)',provider,subject,accountId));
  }
  if(context.accountId)statements.push(this.stmt('INSERT INTO account_nickname_choices(account_id,chosen_at) SELECT ?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND account_id=? AND expires_at>?) ON CONFLICT(account_id) DO NOTHING',accountId,now,context.sessionHash??'',accountId,now));
  const sessionHash=await hashSecret(token);
  statements.push(context.accountId?this.stmt("INSERT INTO sessions SELECT ?,id,?,? FROM accounts WHERE id=? AND status='active' AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND account_id=? AND expires_at>?)",sessionHash,now+SESSION_SECONDS,now,accountId,context.sessionHash??'',accountId,now):this.stmt("INSERT INTO sessions SELECT ?,id,?,? FROM accounts WHERE id=? AND status='active'",sessionHash,now+SESSION_SECONDS,now,accountId));
  // D1 batch is atomic: identity uniqueness races cannot create orphan accounts.
  await this.accounts.db.batch(statements);
  if(!await this.accounts.session(token))throw new AuthFailure('Authentication failed');
  return {accountId,sessionToken:token};
 }
 async googleStart(name:unknown,link:boolean,session:string|undefined){
  if(!this.env.GOOGLE_CLIENT_ID||!this.env.GOOGLE_CLIENT_SECRET)throw new Error('Provider unavailable');
  const context=await this.context(name,link,session),state=randomSecret();
  context.stateHash=await hashSecret(state);context.nonce=randomSecret();context.verifier=randomSecret();
  const token=await this.save('google',context),url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(context.verifier))));
  for(const [key,value] of Object.entries({client_id:this.env.GOOGLE_CLIENT_ID,redirect_uri:this.accounts.origin+'/api/auth/google/callback',response_type:'code',scope:'openid',state,nonce:context.nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}))url.searchParams.set(key,value);
  return {token,url:url.toString()};
 }
 async googleFinish(token:string,state:string,code:string){
  if(!this.env.GOOGLE_CLIENT_ID||!this.env.GOOGLE_CLIENT_SECRET)throw new OAuthFailure('provider_unconfigured');
  if(!token)throw new OAuthFailure('oauth_cookie_missing');
  if(!/^[a-f0-9]{64}$/.test(token)||!/^[a-f0-9]{64}$/.test(state)||!code||code.length>2048)throw new OAuthFailure('callback_invalid');
  const row=await this.stmt("DELETE FROM login_flows WHERE id_hash=? AND purpose='google' AND expires_at>? AND json_extract(context,'$.stateHash')=? RETURNING context",await hashSecret(token),this.accounts.clock(),await hashSecret(state)).first<Flow>();
  if(!row){
   const pending=await this.stmt("SELECT context,expires_at FROM login_flows WHERE id_hash=? AND purpose='google'",await hashSecret(token)).first<{context:string;expires_at:number}>();
   if(!pending)throw new OAuthFailure('flow_missing_or_replayed');
   if(pending.expires_at<=this.accounts.clock())throw new OAuthFailure('flow_expired');
   throw new OAuthFailure('state_mismatch');
  }
  const context=JSON.parse(row.context) as Context;await this.principal(context);
  if(!context.verifier||!context.nonce)throw new OAuthFailure('flow_context_invalid');
  let response:Response;
  try{response=await this.send('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.env.GOOGLE_CLIENT_ID,client_secret:this.env.GOOGLE_CLIENT_SECRET,redirect_uri:this.accounts.origin+'/api/auth/google/callback',grant_type:'authorization_code',code,code_verifier:context.verifier}),signal:AbortSignal.timeout(10000)});}catch{throw new OAuthFailure('token_exchange_network');}
  if(!response.ok){
   let reason='token_exchange_rejected';
   try{const body=await response.json() as {error?:unknown};if(['invalid_client','invalid_grant','redirect_uri_mismatch'].includes(String(body.error)))reason='token_exchange_'+body.error;}catch{}
   throw new OAuthFailure(reason,response.status);
  }
  let result:{id_token?:unknown};try{result=await response.json() as {id_token?:unknown};}catch{throw new OAuthFailure('token_response_invalid');}
  if(!result||typeof result.id_token!=='string')throw new OAuthFailure('id_token_missing');
  const subject=await googleSubject(result.id_token,this.env.GOOGLE_CLIENT_ID,context.nonce).catch(error=>{
   if(error instanceof OAuthFailure)throw error;
   const code=error?.code;
   const reason=code==='ERR_JWT_EXPIRED'?'id_token_expired':code==='ERR_JWS_SIGNATURE_VERIFICATION_FAILED'?'id_token_signature':code==='ERR_JWT_CLAIM_VALIDATION_FAILED'?'id_token_claims':code==='ERR_JWKS_TIMEOUT'?'jwks_timeout':'id_token_verification';
   throw new OAuthFailure(reason);
  });
  return this.identity('google',subject,context);
 }
 private async digest(id:string,code:string):Promise<string>{
  const secret=this.env.AUTH_CODE_SECRET;if(!secret||secret.length<32)throw new Error('Provider unavailable');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(id+':'+code))));
 }
 async emailStart(email:unknown,name:unknown,link:boolean,session:string|undefined,locale:unknown){
  if(!this.env.RESEND_API_KEY||!this.env.EMAIL_FROM||!this.env.AUTH_CODE_SECRET||this.env.AUTH_CODE_SECRET.length<32)throw new Error('Provider unavailable');
  const subject=normalizeEmail(email);if(!subject)throw new AuthFailure('Invalid email');
  const context=await this.context(name,link,session);context.subject=subject;
  if(!await this.accounts.limit('mail-address:'+subject,2,300)||!await this.accounts.limit('mail-global:'+this.accounts.origin,50,86400))return null;
  const token=randomSecret(),id=await hashSecret(token),code=otp();
  await this.save('email',context,await this.digest(id,code),token);
  const ru=locale==='ru';
  try{
   const response=await this.send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+this.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:this.env.EMAIL_FROM,to:[subject],subject:ru?'Код входа RULESHIFT':'Your RULESHIFT sign-in code',text:ru?`Код входа: ${code}. Действует 5 минут. Никому не сообщайте код.`:`Sign-in code: ${code}. Valid for 5 minutes. Do not share this code.`}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error('Delivery unavailable');
  }catch{await this.stmt('DELETE FROM login_flows WHERE id_hash=?',id).run();throw new Error('Delivery unavailable');}
  return token;
 }
 async emailFinish(token:string,code:unknown){
  if(!/^[a-f0-9]{64}$/.test(token)||typeof code!=='string'||!/^\d{6}$/.test(code))throw new AuthFailure('Authentication failed');
  const id=await hashSecret(token),now=this.accounts.clock();
  const row=await this.stmt("UPDATE login_flows SET attempts=attempts+1 WHERE id_hash=? AND purpose='email' AND expires_at>? AND attempts<5 RETURNING context,code_hash,attempts",id,now).first<Flow>();
  if(!row||row.code_hash!==await this.digest(id,code))throw new AuthFailure('Authentication failed');
  const consumed=await this.stmt("DELETE FROM login_flows WHERE id_hash=? AND purpose='email' AND expires_at>? AND code_hash=? RETURNING context",id,now,row.code_hash).first<Flow>();
  if(!consumed)throw new AuthFailure('Authentication failed');
  const context=JSON.parse(consumed.context) as Context;
  return this.identity('email',context.subject!,context);
 }
}
