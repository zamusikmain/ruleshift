// Only allowlisted metadata is printed. Never print Wrangler's raw output.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
export function safeEvent(value){
 const path=(()=>{try{return new URL(value.event?.request?.url).pathname;}catch{return '';}})();
 if(!['/api/auth/google/start','/api/auth/google/callback','/api/auth/providers','/api/account/me','/api/account/nickname'].includes(path))return null;
 const result={path,outcome:String(value.outcome??'unknown').replace(/[^a-z_-]/gi,'').slice(0,40),status:value.event?.response?.status};
 const reasons=[];
 for(const log of value.logs??[])for(const message of log.message??[])try{
  const entry=JSON.parse(message);
  if(entry.event==='google_oauth_callback_failed'&&/^[a-z_]{1,64}$/.test(entry.reason))reasons.push(entry.reason);
 }catch{}
 return {...result,reasons};
}
if(process.argv[1]?.endsWith('auth-diagnostics.mjs')){
 const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','tail','ruleshift-2-staging','--config','wrangler.staging-leaderboard.jsonc','--format','json'],{stdio:['inherit','pipe','pipe']});
 console.log('Staging diagnostics: only route, status, outcome and safe callback reason. Stop with Ctrl+C.');
 let buffer='';
 createInterface({input:child.stdout}).on('line',line=>{
  buffer+=line+'\n';try{const event=JSON.parse(buffer);buffer='';const safe=safeEvent(event);if(safe)console.log(JSON.stringify(safe));}catch{if(buffer.length>1048576)buffer='';}
 });
 child.stderr.on('data',()=>{});
 child.on('error',()=>console.error('Could not start staging diagnostics.'));
 child.on('exit',code=>{console.log('Diagnostics stopped:',code);});
 process.on('SIGINT',()=>child.kill());
}
