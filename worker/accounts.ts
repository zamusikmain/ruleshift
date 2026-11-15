import { generateRegistrationOptions, generateAuthenticationOptions, verifyRegistrationResponse, verifyAuthenticationResponse, type RegistrationResponseJSON, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { validateNickname } from '../src/shared/identity';
import {AuthFailure} from './authFailure';
export const SESSION_SECONDS = 7 * 86400;
export const CHALLENGE_SECONDS = 300;
export function randomSecret(): string { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b=>b.toString(16).padStart(2,'0')).join(''); }
export async function hashSecret(value:string):Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join(''); }
interface Challenge { context:string; account_id:string|null }
interface Context { challenge:string; accountId:string; name:string; recovery?:boolean }
export interface AccountSession { id:string; display_name:string; reauthenticated_at:number }
export class Accounts {
 constructor(readonly db:D1Database,readonly origin:string,readonly rpId:string,readonly clock:()=>number=()=>Math.floor(Date.now()/1000)) {
  const url=new URL(origin);
  if(url.origin!==origin || url.hostname!==rpId || (url.protocol!=='https:'&& !(url.protocol==='http:'&&rpId==='localhost'))) throw new Error('Invalid auth configuration');
 }
 private stmt(sql:string,...args:(string|number|ArrayBuffer|null)[]) {return this.db.prepare(sql).bind(...args);}
 async session(token:string|undefined):Promise<AccountSession|null> {
  if(!token||!/^[a-f0-9]{64}$/.test(token)) return null;
  return this.stmt("SELECT a.id,a.display_name,s.reauthenticated_at FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>? AND a.status='active'",await hashSecret(token),this.clock()).first<AccountSession>();
 }
 async logout(token:string):Promise<void> {await this.stmt('DELETE FROM sessions WHERE token_hash=?',await hashSecret(token)).run();}
 async limit(key:string,max=10,seconds=60):Promise<boolean> {
  const now=this.clock();
  const row=await this.stmt('INSERT INTO request_limits(key,expires_at,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count',await hashSecret(key),now+seconds,now,now,now+seconds).first<{count:number}>();
  await this.stmt('DELETE FROM request_limits WHERE expires_at<=?',now-60).run();
  return !!row&&row.count<=max;
 }
 private async saveChallenge(purpose:'register'|'login',options:{challenge:string},context:Context,accountId:string|null=null) {
  const token=randomSecret(),now=this.clock();
  await this.stmt('INSERT INTO auth_challenges(challenge_hash,account_id,purpose,expires_at,context) VALUES (?,?,?,?,?)',await hashSecret(token),accountId,purpose,now+CHALLENGE_SECONDS,JSON.stringify({...context,challenge:options.challenge})).run();
  await this.stmt('DELETE FROM auth_challenges WHERE expires_at<=?',now).run();
  return token;
 }
 private async consume(token:string,purpose:string):Promise<Context> {
  if(!/^[a-f0-9]{64}$/.test(token)) throw new AuthFailure('Authentication failed');
  const row=await this.stmt('UPDATE auth_challenges SET consumed_at=? WHERE challenge_hash=? AND purpose=? AND consumed_at IS NULL AND expires_at>? RETURNING context,account_id',this.clock(),await hashSecret(token),purpose,this.clock()).first<Challenge>();
  if(!row) throw new AuthFailure('Authentication failed');
  return JSON.parse(row.context) as Context;
 }
 async registration(name:unknown) {
  const valid=validateNickname(name);if(!valid)throw new AuthFailure('Invalid display name');
  return this.registrationFor({accountId:crypto.randomUUID(),name:valid,challenge:''});
 }
 private async registrationFor(context:Context) {
  const options=await generateRegistrationOptions({rpName:'RULESHIFT',rpID:this.rpId,userID:new Uint8Array(new TextEncoder().encode(context.accountId)),userName:context.accountId,userDisplayName:context.name,attestationType:'none',supportedAlgorithmIDs:[-7,-257],authenticatorSelection:{residentKey:'required',userVerification:'required'}});
  const token=await this.saveChallenge('register',options,context,context.recovery?context.accountId:null);
  return {options,token};
 }
 async finishRegistration(token:string,response:RegistrationResponseJSON) {
  const context=await this.consume(token,'register');
  const verified=await verifyRegistrationResponse({response,expectedChallenge:context.challenge,expectedOrigin:this.origin,expectedRPID:this.rpId,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]}).catch(()=>{throw new AuthFailure('Authentication failed');});
  if(!verified.verified)throw new AuthFailure('Authentication failed');
  if(context.recovery && !await this.stmt("SELECT id FROM accounts WHERE id=? AND status='active'",context.accountId).first())throw new AuthFailure('Authentication failed');
  const credential=verified.registrationInfo.credential,now=this.clock(),sessionToken=randomSecret();
  const codes=Array.from({length:8},()=>randomSecret());
  const statements=context.recovery?[
   this.stmt('DELETE FROM sessions WHERE account_id=?',context.accountId),this.stmt('DELETE FROM credentials WHERE account_id=?',context.accountId),this.stmt('DELETE FROM recovery_codes WHERE account_id=?',context.accountId)
  ]:[this.stmt('INSERT INTO accounts(id,display_name,created_at) VALUES (?,?,?)',context.accountId,context.name,now)];
  statements.push(this.stmt('INSERT INTO credentials(credential_id,account_id,public_key,signature_counter,transports) VALUES (?,?,?,?,?)',credential.id,context.accountId,new Uint8Array(credential.publicKey).buffer,credential.counter,JSON.stringify(credential.transports??[])));
  for(const code of codes)statements.push(this.stmt('INSERT INTO recovery_codes(code_hash,account_id) VALUES (?,?)',await hashSecret(code),context.accountId));
  statements.push(this.stmt('INSERT INTO sessions VALUES (?,?,?,?)',await hashSecret(sessionToken),context.accountId,now+SESSION_SECONDS,now));
  statements.push(this.stmt('DELETE FROM auth_challenges WHERE challenge_hash=?',await hashSecret(token)));
  await this.db.batch(statements);
  return {accountId:context.accountId,sessionToken,recoveryCodes:codes};
 }
 async login() {
  const options=await generateAuthenticationOptions({rpID:this.rpId,userVerification:'required'});
  const token=await this.saveChallenge('login',options,{challenge:'',accountId:'',name:''});return {options,token};
 }
 async finishLogin(token:string,response:AuthenticationResponseJSON) {
  const context=await this.consume(token,'login');
  const row=await this.stmt("SELECT c.* FROM credentials c JOIN accounts a ON a.id=c.account_id WHERE c.credential_id=? AND a.status='active'",response.id).first<{credential_id:string;account_id:string;public_key:ArrayBuffer|number[];signature_counter:number}>();
  if(!row)throw new AuthFailure('Authentication failed');
  const verification=await verifyAuthenticationResponse({response,expectedChallenge:context.challenge,expectedOrigin:this.origin,expectedRPID:this.rpId,requireUserVerification:true,credential:{id:row.credential_id,publicKey:new Uint8Array(row.public_key as ArrayBuffer),counter:row.signature_counter}}).catch(()=>{throw new AuthFailure('Authentication failed');});
  if(!verification.verified)throw new AuthFailure('Authentication failed');
  const changed=await this.stmt('UPDATE credentials SET signature_counter=? WHERE credential_id=? AND signature_counter=? RETURNING account_id',verification.authenticationInfo.newCounter,row.credential_id,row.signature_counter).first();
  if(!changed)throw new AuthFailure('Authentication failed');
  const sessionToken=randomSecret(),now=this.clock();
  await this.stmt("INSERT INTO sessions SELECT ?,id,?,? FROM accounts WHERE id=? AND status='active'",await hashSecret(sessionToken),now+SESSION_SECONDS,now,row.account_id).run();
  return {sessionToken,accountId:row.account_id};
 }
 async recover(code:string) {
  if(!/^[a-f0-9]{64}$/.test(code))throw new AuthFailure('Authentication failed');
  const row=await this.stmt("UPDATE recovery_codes SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL AND account_id IN (SELECT id FROM accounts WHERE status='active') RETURNING account_id",this.clock(),await hashSecret(code)).first<{account_id:string}>();
  if(!row)throw new AuthFailure('Authentication failed');
  await this.stmt('DELETE FROM sessions WHERE account_id=?',row.account_id).run();
  const account=await this.stmt("SELECT display_name FROM accounts WHERE id=? AND status='active'",row.account_id).first<{display_name:string}>();
  if(!account)throw new AuthFailure('Authentication failed');
  return this.registrationFor({accountId:row.account_id,name:account.display_name,challenge:'',recovery:true});
 }
 async deleteAccount(session:AccountSession):Promise<void> {
  if(this.clock()-session.reauthenticated_at>300)throw new AuthFailure('Recent passkey authentication required');
  const id=session.id;
  await this.db.batch([
   this.stmt("UPDATE accounts SET display_name='Deleted',status='deleted' WHERE id=?",id),
   ...['sessions','credentials','recovery_codes','ratings','participants','settlement_ledger','auth_challenges','auth_identities','account_nickname_choices'].map(t=>this.stmt(`DELETE FROM ${t} WHERE account_id=?`,id)),
   this.stmt("DELETE FROM login_flows WHERE json_extract(context,'$.accountId')=?",id),
   this.stmt("DELETE FROM auth_challenges WHERE json_extract(context,'$.accountId')=?",id),
   this.stmt('DELETE FROM pair_history WHERE account_low=? OR account_high=?',id,id)
  ]);
 }
}

