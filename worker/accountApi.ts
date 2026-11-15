import { Accounts, SESSION_SECONDS, CHALLENGE_SECONDS } from './accounts';
import {Rankings,utcSeason} from './rankings';
import {AuthFailure,OAuthFailure} from './authFailure';
import {randomSecret,hashSecret} from './accounts';
import {validateNickname} from '../src/shared/identity';
import type {SimpleAuthEnv} from './simpleAuth';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
export interface AuthEnv extends SimpleAuthEnv { RANKINGS_DB?:D1Database; AUTH_ORIGIN?:string; AUTH_RP_ID?:string }
export function cookieToken(request:Request,name:string):string|undefined {
 const cookies=(request.headers.get('Cookie')??'').split(';').map(s=>s.trim());
 const matches=cookies.filter(s=>s.startsWith(name+'='));return matches.length===1?matches[0].slice(name.length+1):undefined;
}
export const SESSION_COOKIE='__Host-ruleshift-session';
const CHALLENGE_COOKIE='__Host-ruleshift-challenge';
function cookie(name:string,value:string,seconds:number):string {return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;}
function reply(body:unknown,status=200,cookies:string[]=[]) {
 const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff'});
 for(const c of cookies)headers.append('Set-Cookie',c);
 return new Response(JSON.stringify(body),{status,headers});
}
async function body(request:Request):Promise<Record<string,unknown>> {
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new Error('invalid');
 if(!request.body)throw new Error('invalid');
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try {for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>16384){await reader.cancel();throw new Error('invalid');}chunks.push(value);}} finally {reader.releaseLock();}
 const buffer=new Uint8Array(length);let at=0;for(const chunk of chunks){buffer.set(chunk,at);at+=chunk.length;}
 const value:unknown=JSON.parse(new TextDecoder().decode(buffer));
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid');return value as Record<string,unknown>;
}
export async function accountApi(request:Request,env:AuthEnv):Promise<Response> {
 if(new URL(request.url).pathname==='/api/auth/providers'&&request.method==='GET'&&(!env.RANKINGS_DB||!env.AUTH_ORIGIN||!env.AUTH_RP_ID))return reply({accounts:false,google:false,email:false});
 if(!env.RANKINGS_DB||!env.AUTH_ORIGIN||!env.AUTH_RP_ID)return reply({error:'serviceUnavailable'},503);
 const url=new URL(request.url);
 if(url.origin!==env.AUTH_ORIGIN)return reply({error:'forbidden'},403);
 if(request.method!=='GET'&&(request.method!=='POST'||request.headers.get('Origin')!==env.AUTH_ORIGIN))return reply({error:'forbidden'},403);
 try {
  const accounts=new Accounts(env.RANKINGS_DB,env.AUTH_ORIGIN,env.AUTH_RP_ID);
  const scope=url.pathname.startsWith('/api/auth/')?'auth':'profile';
  if(!await accounts.limit(`${scope}:${env.AUTH_ORIGIN}:${request.headers.get('CF-Connecting-IP')??'local'}`,scope==='auth'?10:30))return reply({error:'rateLimit'},429);
  const token=cookieToken(request,SESSION_COOKIE),challenge=cookieToken(request,CHALLENGE_COOKIE)??'';
  if(url.pathname.startsWith('/api/leaderboard')&&request.method==='GET'){
   const rankings=new Rankings(env.RANKINGS_DB);
   if(url.pathname==='/api/leaderboard/seasons')return reply({seasons:await rankings.seasons(),current:utcSeason(Date.now()/1000).id});
   if(!['/api/leaderboard','/api/leaderboard/me'].includes(url.pathname))return reply({error:'notFound'},404);
   const session=await accounts.session(token);
   if(url.pathname.endsWith('/me')&&!session)return reply({error:'unauthorized'},401);
   const mode=url.searchParams.get('mode')??'overall',season=url.searchParams.get('season')??utcSeason(Date.now()/1000).id;
   if(!['overall','classic','lastOneStanding','blitz','chaos'].includes(mode)||!(season==='lifetime'||/^\d{4}-(0[1-9]|1[0-2])$/.test(season)))return reply({error:'invalidMessage'},400);
   return reply(await rankings.table(mode,season,session?.id));
  }
  if(url.pathname==='/api/account/me'&&request.method==='GET') {
   const session=await accounts.session(token);if(!session)return reply({error:'unauthorized'},401);const identity=await env.RANKINGS_DB.prepare('SELECT account_id FROM auth_identities WHERE account_id=? LIMIT 1').bind(session.id).first();const chosen=await env.RANKINGS_DB.prepare('SELECT account_id FROM account_nickname_choices WHERE account_id=?').bind(session.id).first();const linked=await env.RANKINGS_DB.prepare('SELECT provider FROM auth_identities WHERE account_id=? ORDER BY provider').bind(session.id).all<{provider:string}>();const passkey=await env.RANKINGS_DB.prepare('SELECT credential_id FROM credentials WHERE account_id=? LIMIT 1').bind(session.id).first();return reply({accountId:session.id,name:session.display_name,needsNickname:!!identity&&!chosen,methods:[...linked.results.map(row=>row.provider),...(passkey?['passkey']:[])]});
  }
  if(url.pathname==='/api/auth/providers'&&request.method==='GET')return reply({accounts:true,google:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),email:!!(env.RESEND_API_KEY&&env.EMAIL_FROM&&env.AUTH_CODE_SECRET&&env.AUTH_CODE_SECRET.length>=32)});
  if(url.pathname==='/api/auth/google/callback'&&request.method==='GET'){
   const headers=new Headers({'Cache-Control':'no-store','Location':'/?auth=failed#account'});
   headers.append('Set-Cookie','__Host-ruleshift-oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
   try{
    if(url.searchParams.has('error'))throw new OAuthFailure('provider_denied');
    if(url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1)throw new OAuthFailure('callback_invalid');
    const {SimpleAuth}=await import('./simpleAuth');
    const result=await new SimpleAuth(accounts,env).googleFinish(cookieToken(request,'__Host-ruleshift-oauth')??'',url.searchParams.get('state')!,url.searchParams.get('code')!);
    headers.set('Location','/#account');headers.append('Set-Cookie',cookie(SESSION_COOKIE,result.sessionToken,SESSION_SECONDS));
   }catch(error){
    // No request URL, cookies, provider body, JWT, message or stack in logs.
    console.warn(JSON.stringify({event:'google_oauth_callback_failed',reason:error instanceof OAuthFailure?error.reason:error instanceof AuthFailure?'account_link_rejected':'service_unavailable',...(error instanceof OAuthFailure&&error.upstreamStatus!==undefined?{upstreamStatus:error.upstreamStatus}:{}),responseStatus:303}));
   }
   return new Response(null,{status:303,headers});
  }
  if(request.method!=='POST')return reply({error:'notFound'},404);
  let input:Record<string,unknown>;try{input=await body(request);}catch{return reply({error:'invalidMessage'},400);}
  if(url.pathname==='/api/account/nickname'){
   const session=await accounts.session(token);if(!session)return reply({error:'unauthorized'},401);
   const name=validateNickname(input.name);if(!name)return reply({error:'invalidName'},400);
   if(!await accounts.limit('nickname:'+session.id,3))return reply({error:'rateLimit'},429);
   await env.RANKINGS_DB.batch([env.RANKINGS_DB.prepare("UPDATE accounts SET display_name=? WHERE id=? AND status='active'").bind(name,session.id),env.RANKINGS_DB.prepare("INSERT INTO account_nickname_choices(account_id,chosen_at) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET chosen_at=excluded.chosen_at").bind(session.id,accounts.clock())]);
   return reply({accountId:session.id,name});
  }
  if(['/api/auth/google/start','/api/auth/email/start','/api/auth/email/verify'].includes(url.pathname)){
   const {SimpleAuth}=await import('./simpleAuth');const auth=new SimpleAuth(accounts,env);
   if(url.pathname.endsWith('/google/start')){
    const result=await auth.googleStart(input.name,input.link===true,token);
    return reply({url:result.url},200,[`__Host-ruleshift-oauth=${result.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`]);
   }
   if(url.pathname.endsWith('/email/start')){
    if(!await accounts.limit('mail-ip:'+env.AUTH_ORIGIN+':'+(request.headers.get('CF-Connecting-IP')??'local'),3,300))return reply({error:'rateLimit'},429);
    const flow=await auth.emailStart(input.email,input.name,input.link===true,token,input.locale);
    return reply({ok:true},202,[cookie('__Host-ruleshift-email',flow??randomSecret(),300)]);
   }
   const result=await auth.emailFinish(cookieToken(request,'__Host-ruleshift-email')??'',input.code);
   return reply({accountId:result.accountId},200,[cookie(SESSION_COOKIE,result.sessionToken,SESSION_SECONDS),cookie('__Host-ruleshift-email','',0)]);
  }
  if(url.pathname==='/api/auth/register/options') {
   const result=await accounts.registration(input.name);return reply(result.options,200,[cookie(CHALLENGE_COOKIE,result.token,CHALLENGE_SECONDS)]);
  }
  if(url.pathname==='/api/auth/login/options') {
   const result=await accounts.login();return reply(result.options,200,[cookie(CHALLENGE_COOKIE,result.token,CHALLENGE_SECONDS)]);
  }
  if(url.pathname==='/api/auth/register/verify'||url.pathname==='/api/auth/login/verify') {
   if(!input.response||typeof input.response!=='object')return reply({error:'authenticationFailed'},400);
   const result=url.pathname.includes('/register/')?await accounts.finishRegistration(challenge,input.response as RegistrationResponseJSON):await accounts.finishLogin(challenge,input.response as AuthenticationResponseJSON);
   return reply({accountId:result.accountId,...('recoveryCodes' in result?{recoveryCodes:result.recoveryCodes}:{})},200,[cookie(SESSION_COOKIE,result.sessionToken,SESSION_SECONDS),cookie(CHALLENGE_COOKIE,'',0)]);
  }
  if(url.pathname==='/api/auth/recover') {
   if(typeof input.code!=='string')return reply({error:'authenticationFailed'},400);
   const result=await accounts.recover(input.code);return reply(result.options,200,[cookie(CHALLENGE_COOKIE,result.token,CHALLENGE_SECONDS),cookie(SESSION_COOKIE,'',0)]);
  }
  if(url.pathname==='/api/auth/logout') {
   if(token)await accounts.logout(token);for(const name of ['__Host-ruleshift-oauth','__Host-ruleshift-email']){const flow=cookieToken(request,name);if(flow)await env.RANKINGS_DB.prepare('DELETE FROM login_flows WHERE id_hash=?').bind(await hashSecret(flow)).run();}return reply({ok:true},200,[cookie(SESSION_COOKIE,'',0),cookie(CHALLENGE_COOKIE,'',0),cookie('__Host-ruleshift-email','',0),cookie('__Host-ruleshift-oauth','',0)]);
  }
  if(url.pathname==='/api/account/delete') {
   const session=await accounts.session(token);if(!session)return reply({error:'unauthorized'},401);
   if(input.confirm!==true)return reply({error:'invalidMessage'},400);
   await accounts.deleteAccount(session);return reply({ok:true},200,[cookie(SESSION_COOKIE,'',0)]);
  }
  return reply({error:'notFound'},404);
 } catch(error) {return error instanceof AuthFailure?reply({error:'authenticationFailed'},400):reply({error:'serviceUnavailable'},503);}
}
