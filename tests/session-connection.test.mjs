import {test} from 'node:test';import assert from 'node:assert/strict';import {loadModule} from './load.mjs';import {webcrypto} from 'node:crypto';
test('GameRoom session revocation closes authenticated sockets and restart responds matchReset',async()=>{
 const data=new Map([['exists',true],['ranked-start',{id:'interrupted-match',roomMatchId:1}]]);let ready;
 const ctx={blockConcurrencyWhile:fn=>ready=fn(),storage:{get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),delete:async k=>data.delete(k)}};
 const Base=class{constructor(ctx,env){this.ctx=ctx;this.env=env;}};
 const {GameRoom}=loadModule('../worker/index',{crypto:webcrypto,Request,Response,URL},{'cloudflare:workers':{DurableObject:Base,WorkerEntrypoint:Base}});
 let valid=true;const env={RANKINGS_DB:{prepare:()=>({bind:()=>({all:async()=>({results:valid?[{token_hash:'hash',account_id:'account'}]:[]})})})}};
 const room=new GameRoom(ctx,env);await ready;
 assert.equal(data.get('interrupted:interrupted-match').status,'interrupted');
 const reset=await room.fetch(new Request('https://game.example/api/rooms/ABC234'));assert.equal(reset.status,404);assert.equal((await reset.json()).error,'matchReset');
 const packets=[],socket={send:s=>packets.push(JSON.parse(s)),close(){this.closed=true;}};room.sessions.set(socket,{accountId:'account',sessionHash:'hash',joined:true});await room.validateSessions(Date.now());assert.equal(socket.closed,undefined);valid=false;await room.validateSessions(Date.now());assert.equal(socket.closed,true);assert.equal(room.sessions.size,0);assert.equal(packets[0].code,'matchReset');
});
test('client logout clears active connection subscriptions after dispose',async()=>{
 const calls=[];const {leaderboardApi,onSessionRevoked}=loadModule('leaderboardApi',{fetch:async()=>({ok:true,json:async()=>({ok:true})})});
 const unsubscribe=onSessionRevoked(()=>calls.push('socket closed'));await leaderboardApi.logout();assert.equal(calls.length,1);unsubscribe();await leaderboardApi.logout();assert.equal(calls.length,1);
});
test('trusted registered nickname is used on hello, reconnect, Rematch and live snapshots',async()=>{
 let ready;const ctx={blockConcurrencyWhile:fn=>ready=fn(),storage:{get:async()=>undefined,put:async()=>{},delete:async()=>{}}};
 const Base=class{constructor(ctx,env){this.ctx=ctx;this.env=env;}};
 const {GameRoom}=loadModule('../worker/index',{crypto:webcrypto,Request,Response,URL},{'cloudflare:workers':{DurableObject:Base,WorkerEntrypoint:Base}});
 const {Room}=loadModule('shared/room',{crypto:webcrypto});const {PROTOCOL_VERSION}=loadModule('shared/protocol');
 let name='Trusted';const env={RANKINGS_DB:{prepare:()=>({bind:()=>({all:async()=>({results:[{token_hash:'hash',account_id:'account',display_name:name}]})})})}};
 const room=new GameRoom(ctx,env);await ready;room.room=new Room('ABC234');
 const socket=()=>({packets:[],send(value){this.packets.push(JSON.parse(value));},close(){}}),first=socket();
 const session=()=>({accountId:'account',accountName:name,sessionHash:'hash',joined:false,window:Date.now(),count:0,lastSeen:Date.now()});room.sessions.set(first,session());
 await room.message(first,JSON.stringify({type:'hello',protocol:PROTOCOL_VERSION,name:'Spoofed',color:0}));
 const welcome=first.packets.find(p=>p.type==='welcome'),member=room.room.members.get(welcome.id);assert.equal(member.state.name,'Trusted');
 name='Renamed';await room.validateSessions(Date.now());assert.equal(member.state.name,'Renamed');assert.equal(member.state.id,welcome.id);
 room.close(first);const second=socket();room.sessions.set(second,session());await room.message(second,JSON.stringify({type:'hello',protocol:PROTOCOL_VERSION,name:'SpoofAgain',color:0,token:welcome.token}));assert.equal(second.packets.find(p=>p.type==='welcome').id,welcome.id);assert.equal(member.state.name,'Renamed');
 room.room.phase='results';room.room.command(welcome.id,{type:'rematch'});assert.equal(member.state.name,'Renamed');assert.equal(room.principals.get(welcome.id),'account');
});
test('gateway transports Cyrillic nickname safely and strips the browser-supplied name',async()=>{
 let forwarded;
 const Base=class{};const {default:worker}=loadModule('../worker/index',{crypto:webcrypto,Request,Response,URL},{'cloudflare:workers':{DurableObject:Base,WorkerEntrypoint:Base},'./accounts':{Accounts:class{async session(){return {id:'trusted-account',display_name:'Игрок 2'};}},hashSecret:async()=> 'trusted-hash'},'./accountApi':{cookieToken:()=> 'token',SESSION_COOKIE:'session'}});
 const env={RANKINGS_DB:{},AUTH_ORIGIN:'https://game.example',AUTH_RP_ID:'game.example',ROOMS:{idFromName:n=>n,get:()=>({fetch:async request=>{forwarded=request;return new Response('ok');}})}};
 const response=await worker.fetch(new Request('https://game.example/api/rooms/ABC234',{headers:{Origin:'https://game.example',Upgrade:'websocket','X-Ruleshift-Name':'spoof'}}),env);
 assert.equal(response.status,200);assert.equal(decodeURIComponent(forwarded.headers.get('X-Ruleshift-Name')),'Игрок 2');assert.equal(forwarded.headers.get('X-Ruleshift-Account'),'trusted-account');
});
