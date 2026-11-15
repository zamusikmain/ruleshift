import {chooseGuest,resetEntry} from './authEntry';
import {t,getLocale,type TextKey} from './locales';
import {leaderboardApi,ApiError,onRankingsChanged,type Account} from './leaderboardApi';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function accountError(error:unknown):TextKey {
 if(!(error instanceof ApiError))return 'rankAuthFailed';
 if(error.code==='timeout')return 'authTimeout';
 if(error.status===0)return 'authNetwork';
 if(error.status===429)return 'authRate';
 if(error.status>=500)return 'accountUnavailable';
 if(error.code==='invalidName')return 'invalidName';
 if(error.status===403)return 'authForbidden';
 return 'rankAuthFailed';
}
export function showAccounts(root:HTMLElement,mount:(html:string,rerender:()=>void)=>void,back:()=>void,name:string,onAccount?:(account:Account)=>void,callbackFailed=false,startup=false){
 let sessionState:'checking'|'ready'|'failed'='checking';
 let navigating=false;
 let navigationTimer:ReturnType<typeof setTimeout>|undefined;
 const finish=()=>{if(closed)return;closed=true;sequence++;unsubscribe();if(poll!==undefined)clearInterval(poll);if(navigationTimer!==undefined)clearTimeout(navigationTimer);back();};
 let account:Account|null=null,status:TextKey='entryLoading',busy=false,codes:string[]=[],sequence=0,closed=false,authError=callbackFailed,draftName=name,providers={accounts:false,google:false,email:false},email='',emailCode='',emailOpen=false,emailSent=false,resendAt=0,linkEmail=false;
 const btn=(id:string,key:TextKey,disabled=false)=>`<button id="${id}" ${disabled?'disabled':''}>${t(key)}</button>`;
 const render=()=>{
  if(closed)return;
  if(sessionState!=='ready'){
   mount(`<p role="status" aria-live="polite">${t(status)}</p>${sessionState==='failed'?btn('account-retry','rankRefresh'):''}${!startup?btn('back','back'):''}`,render);
   const retry=root.querySelector<HTMLElement>('#account-retry');if(retry)retry.onclick=()=>{void load();};
   const exit=root.querySelector<HTMLElement>('#back');if(exit)exit.onclick=()=>{closed=true;sequence++;unsubscribe();if(poll!==undefined)clearInterval(poll);back();};
   return;
  }
  draftName=root.querySelector<HTMLInputElement>('#account-name')?.value??draftName;
  email=root.querySelector<HTMLInputElement>('#auth-email-address')?.value??email;
  emailCode=root.querySelector<HTMLInputElement>('#auth-email-code')?.value??emailCode;
  const nick=`<label>${t('authNickname')}<input id="account-name" minlength="3" maxlength="16" value="${escape(draftName)}" autocomplete="nickname"></label>`;
  const emailForm=emailOpen?`<form id="email-form"><label>${t('authEmailAddress')}<input id="auth-email-address" type="email" maxlength="254" autocomplete="email" required value="${escape(email)}"></label>${btn('auth-send',emailSent?'authResend':'authSend',busy||Date.now()<resendAt)}</form>${emailSent?`<p>${t('authSent')}</p><form id="email-verify-form"><label>${t('authCode')}<input id="auth-email-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required value="${escape(emailCode)}"></label>${btn('auth-verify','authVerify',busy)}</form>`:''}`:'';
  const primary=`${btn('auth-google',account?'authLinkGoogle':'authGoogle',busy||!providers.google)}${!providers.google?'<small>'+t('authUnavailable')+'</small>':''}${btn('auth-email',account?'authLinkEmail':'authEmail',busy||!providers.email)}${!providers.email?'<small>'+t('authUnavailable')+'</small>':''}${emailForm}`;
  const auth=account?`<p>${t('rankAccount')}: ${escape(account.name)}</p><p>${t('accountType')}: ${(account.methods??['passkey']).map(escape).join(' / ')}</p><p>${t('linkedMethods')}: ${(account.methods??['passkey']).map(escape).join(', ')}</p>${nick}${btn('account-rename',startup?'authSaveContinue':'save',busy)}<p>${t('authLinkHint')}</p>${primary}${btn('account-logout','rankLogout',busy||codes.length>0)}${btn('account-delete','rankDelete',busy||codes.length>0)}`:`<p>${t('accountType')}: ${t('guestAccount')}</p>${primary}${btn('auth-guest','authGuest',busy)}<p class="hint">${t('guestProgressHint')}</p><details><summary>${t('legacyAccess')}</summary>${btn('account-login','rankLogin',busy||!providers.accounts)}<label>${t('rankRecoveryCode')}<input id="account-code" type="password" autocomplete="off" maxlength="64"></label>${btn('account-recover','rankRecover',busy||!providers.accounts)}</details>`;
  mount(`<section class="rank-account">${startup?'<p>'+t('entryPrompt')+'</p>':''}${startup&&account?nick+btn('account-rename','authSaveContinue',busy):auth}</section>${codes.length?`<section role="alert"><h3>${t('rankRecoverySave')}</h3><p>${t('rankRecoveryWarning')}</p><textarea readonly rows="8" aria-label="${t('rankRecoverySave')}">${codes.join('\n')}</textarea>${btn('codes-dismiss','rankCodesSaved')}</section>`:''}<p role="status" aria-live="polite">${status?t(status):''}</p>${btn('account-retry','rankRefresh',busy)}${!startup?btn('back',account&&startup?'continue':'back',busy||codes.length>0):''}`,render);
  const bind=(id:string,fn:()=>void)=>{const el=root.querySelector<HTMLElement>('#'+id);if(el)el.onclick=()=>{if(busy||codes.length)return;fn();};};


  bind('account-retry',()=>{void load();});bind('back',()=>{if(busy||codes.length)return;closed=true;sequence++;codes=[];unsubscribe();if(poll!==undefined)clearInterval(poll);back();});
  const dismiss=root.querySelector<HTMLElement>('#codes-dismiss');if(dismiss)dismiss.onclick=()=>{codes=[];if(startup&&account&&!account.needsNickname){finish();return;}render();};
  const action=async(fn:()=>Promise<unknown>)=>{if(busy||codes.length)return;sequence++;authError=false;callbackFailed=false;busy=true;status='rankAuthWorking';render();try{const result=await fn();if(result&&typeof result==='object'&&'recoveryCodes' in result)codes=(result as {recoveryCodes:string[]}).recoveryCodes;if(!navigating&&!closed)await load();}catch(error){navigating=false;authError=true;status=accountError(error);}finally{if(!navigating)busy=false;render();}};
  bind('auth-google',()=>{if(!providers.google)return;void action(async()=>{const result=await leaderboardApi.googleStart('',!!account);const url=new URL(result.url);if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')throw new ApiError(400);navigating=true;window.location.assign(url.href);navigationTimer=setTimeout(()=>{if(closed)return;navigating=false;busy=false;authError=true;status='authTimeout';render();},20000);});});
  bind('auth-email',()=>{if(!providers.email)return;emailOpen=true;linkEmail=!!account;render();});
  bind('auth-guest',()=>{chooseGuest();closed=true;sequence++;unsubscribe();if(poll!==undefined)clearInterval(poll);back();});
  const send=root.querySelector<HTMLFormElement>('#email-form');if(send)send.onsubmit=event=>{event.preventDefault();if(Date.now()<resendAt){status='authWait';render();return;}email=root.querySelector<HTMLInputElement>('#auth-email-address')!.value;void action(async()=>{await leaderboardApi.emailStart(email,'',getLocale(),linkEmail);emailSent=true;emailCode='';resendAt=Date.now()+60000;});};
  const verify=root.querySelector<HTMLFormElement>('#email-verify-form');if(verify)verify.onsubmit=event=>{event.preventDefault();const value=root.querySelector<HTMLInputElement>('#auth-email-code')!.value;if(!/^[0-9]{6}$/.test(value)){status='authInvalid';render();return;}void action(async()=>{await leaderboardApi.emailVerify(value);emailCode='';const field=root.querySelector<HTMLInputElement>('#auth-email-code');if(field)field.value='';emailOpen=false;emailSent=false;});};
  bind('account-rename',()=>{const value=root.querySelector<HTMLInputElement>('#account-name')!.value;void action(async()=>{const saved=await leaderboardApi.rename(value);account=saved;draftName=saved.name;onAccount?.(saved);if(startup)finish();});});
  bind('account-login',()=>{void action(()=>leaderboardApi.login());});
  bind('account-recover',()=>{const value=root.querySelector<HTMLInputElement>('#account-code')!.value;void action(()=>leaderboardApi.recover(value));});
  bind('account-logout',()=>{const field=root.querySelector<HTMLInputElement>('#account-code');if(field)field.value='';codes=[];const emailField=root.querySelector<HTMLInputElement>('#auth-email-address');if(emailField)emailField.value='';email='';emailCode='';emailOpen=false;emailSent=false;linkEmail=false;void action(async()=>{await leaderboardApi.logout();resetEntry();closed=true;unsubscribe();if(poll!==undefined)clearInterval(poll);back();});});
  bind('account-delete',()=>{if(confirm(t('rankDeleteConfirm')))void action(()=>leaderboardApi.deleteAccount());});
 };
 const load=async()=>{
  const ticket=++sequence;sessionState='checking';status='entryLoading';render();
  try{
   const configured=await leaderboardApi.providers();providers=configured;const me=configured.accounts?await leaderboardApi.me().catch(e=>{if(e instanceof ApiError&&e.status===401)return null;throw e;}):null;
   if(closed||ticket!==sequence)return;
   sessionState='ready';account=me;if(account){draftName=account.name;const field=root.querySelector<HTMLInputElement>('#account-name');if(field)field.value=account.name;onAccount?.(account);}
   if(startup&&account&&!account.needsNickname&&!codes.length&&!callbackFailed){finish();return;}
   status=callbackFailed?'rankAuthFailed':account?'accountReady':'entryPrompt';render();
  }catch(error){if(closed||ticket!==sequence)return;sessionState='failed';status=accountError(error);render();}
 };
 const unsubscribe=onRankingsChanged(()=>{if(!busy&&!codes.length&&!authError)void load();});
 const poll=typeof setInterval==='function'?setInterval(()=>{if(!closed&&!busy&&resendAt&&Date.now()>=resendAt){resendAt=0;if(emailOpen)render();}},1000):undefined;
 void load();
}

