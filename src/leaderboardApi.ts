export interface RankRow {accountId:string;name:string;points:number;games:number;wins:number;losses:number;draws:number;winPercent:number;streak:number;place:number}
export interface RankTable {mode:string;season:string;top:RankRow[];me:RankRow|null}
export interface Account {accountId:string;name:string;needsNickname?:boolean;methods?:string[]}
export interface Season {id:string;starts_at:number;closes_at:number;status:string}
export class ApiError extends Error {constructor(readonly status:number,readonly code?:string){super('Request failed');}}
export async function request<T>(path:string,body?:unknown):Promise<T>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
 let response:Response;try{response=await fetch(path,{signal:controller.signal,credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});}catch{throw new ApiError(0,controller.signal.aborted?'timeout':'network');}
 if(!response.ok){const data=await response.json().catch(()=>({}));if(controller.signal.aborted)throw new ApiError(0,'timeout');throw new ApiError(response.status,typeof data.error==='string'?data.error:undefined);}
 try{return await response.json() as T;}catch{throw new ApiError(controller.signal.aborted?0:response.status,controller.signal.aborted?'timeout':'invalidResponse');}
 }finally{clearTimeout(timer);}
}
const revoked=new Set<()=>void>(),changed=new Set<()=>void>();
export const onSessionRevoked=(fn:()=>void)=>{revoked.add(fn);return ()=>{revoked.delete(fn);};};
export const onRankingsChanged=(fn:()=>void)=>{changed.add(fn);return ()=>{changed.delete(fn);};};
export function rankingsChanged(){for(const fn of changed)fn();}
function revoke(){for(const fn of revoked)fn();rankingsChanged();}
const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)).buffer;
const encode=(buffer:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function serialize(c:PublicKeyCredential){
 const r=c.response as AuthenticatorAttestationResponse&AuthenticatorAssertionResponse;
 const response:Record<string,unknown>={clientDataJSON:encode(r.clientDataJSON)};
 if(r.attestationObject){response.attestationObject=encode(r.attestationObject);response.transports=r.getTransports?.()??[];}
 else{response.authenticatorData=encode(r.authenticatorData);response.signature=encode(r.signature);if(r.userHandle)response.userHandle=encode(r.userHandle);}
 return {id:c.id,rawId:encode(c.rawId),type:c.type,clientExtensionResults:c.getClientExtensionResults(),response};
}
interface CreationJSON extends Omit<PublicKeyCredentialCreationOptions,'challenge'|'user'|'excludeCredentials'> {challenge:string;user:{id:string;name:string;displayName:string};excludeCredentials?:{id:string;type:'public-key'}[]}
interface LoginJSON extends Omit<PublicKeyCredentialRequestOptions,'challenge'|'allowCredentials'> {challenge:string;allowCredentials?:{id:string;type:'public-key'}[]}
export interface Registered {accountId:string;recoveryCodes:string[]}
async function create(options:CreationJSON):Promise<Registered>{
 const credential=await navigator.credentials.create({publicKey:{...options,challenge:decode(options.challenge),user:{...options.user,id:decode(options.user.id)},excludeCredentials:options.excludeCredentials?.map(c=>({...c,id:decode(c.id)}))}});
 if(!credential)throw new ApiError(400);
 const result=await request<Registered>('/api/auth/register/verify',{response:serialize(credential as PublicKeyCredential)});rankingsChanged();return result;
}
export const leaderboardApi={
 providers:()=>request<{accounts:boolean;google:boolean;email:boolean}>('/api/auth/providers'),
 rename:(name:string)=>request<Account>('/api/account/nickname',{name}),
 googleStart:(name:string,link=false)=>request<{url:string}>('/api/auth/google/start',{name,link}),
 emailStart:(email:string,name:string,locale:string,link=false)=>request('/api/auth/email/start',{email,name,locale,link}),
 emailVerify:async(code:string)=>{await request('/api/auth/email/verify',{code});rankingsChanged();},
 me:()=>request<Account>('/api/account/me'),
 seasons:()=>request<{current:string;seasons:Season[]}>('/api/leaderboard/seasons'),
 table:(mode:string,season:string)=>request<RankTable>(`/api/leaderboard?mode=${encodeURIComponent(mode)}&season=${encodeURIComponent(season)}`),
 register:async(name:string)=>create(await request<CreationJSON>('/api/auth/register/options',{name})),
 login:async()=>{const options=await request<LoginJSON>('/api/auth/login/options',{});const credential=await navigator.credentials.get({publicKey:{...options,challenge:decode(options.challenge),allowCredentials:options.allowCredentials?.map(c=>({...c,id:decode(c.id)}))}});if(!credential)throw new ApiError(400);await request('/api/auth/login/verify',{response:serialize(credential as PublicKeyCredential)});rankingsChanged();},
 recover:async(code:string)=>{const options=await request<CreationJSON>('/api/auth/recover',{code});revoke();return create(options);},
 logout:async()=>{await request('/api/auth/logout',{});revoke();},
 deleteAccount:async()=>{await request('/api/account/delete',{confirm:true});revoke();}
};
