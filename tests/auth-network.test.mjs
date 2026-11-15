import {test} from 'node:test';import assert from 'node:assert/strict';import {loadModule} from './load.mjs';import {safeEvent} from '../scripts/auth-diagnostics.mjs';
function api(fetch,timers={setTimeout,clearTimeout}){return loadModule('leaderboardApi',{fetch,AbortController,...timers});}
test('auth requests distinguish HTTP rejection, network failure and timeout without leaking values',async()=>{
 const denied=api(async()=>({ok:false,status:403,json:async()=>({error:'forbidden'})}));await assert.rejects(denied.request('/api/auth/google/start',{}),e=>e.status===403&&e.code==='forbidden');
 const network=api(async()=>{throw Error('secret');});await assert.rejects(network.request('/api/account/me'),e=>e.status===0&&e.code==='network'&&!e.message.includes('secret'));
 let abort,cleared=0;const slow=api(async(_,options)=>{abort();assert.equal(options.signal.aborted,true);throw Error();},{setTimeout:fn=>{abort=fn;return 1;},clearTimeout:()=>cleared++});await assert.rejects(slow.request('/api/account/me'),e=>e.code==='timeout');assert.equal(cleared,1);
});
test('diagnostics omit query strings, cookies, identities and arbitrary log data',()=>{
 const result=safeEvent({event:{request:{url:'https://staging/api/auth/google/callback?code=secret&state=secret',headers:{cookie:'secret'}},response:{status:303}},outcome:'ok',logs:[{message:[JSON.stringify({event:'google_oauth_callback_failed',reason:'state_mismatch',token:'secret'}),'private-message']}]});assert.deepEqual(result,{path:'/api/auth/google/callback',outcome:'ok',status:303,reasons:['state_mismatch']});assert.equal(JSON.stringify(result).includes('secret'),false);
});
