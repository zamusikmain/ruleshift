import type {Room} from '../src/shared/room';
import {Rankings,type MatchReceipt} from './rankings';
interface Started {id:string;roomMatchId:number;startedAt:number;mode:MatchReceipt['mode'];players:{id:string;accountId:string}[]}
/** Private to GameRoom: no public endpoint accepts receipts. */
export class RoomRankings {
 private started?:Started;
 constructor(private storage:DurableObjectStorage,private db:D1Database){}
 async interrupt():Promise<void>{
  const start=await this.storage.get<Started>('ranked-start');
  if(!start)return;
  if(!await this.storage.get('completed:'+start.id)&&!await this.storage.get('outbox:'+start.id))await this.storage.put('interrupted:'+start.id,{...start,status:'interrupted',reason:'restart'});
  await this.storage.delete('ranked-start');
 }
 async capture(room:Room,principals:Map<string,string>):Promise<void>{
  if(room.phase==='countdown'&&this.started?.roomMatchId!==room.matchId){
   const players=[...room.members.values()].map(m=>({id:m.state.id,accountId:principals.get(m.state.id)??''}));
   this.started={id:crypto.randomUUID(),roomMatchId:room.matchId,startedAt:Math.floor(Date.now()/1000),mode:room.mode,players};
   await this.storage.put('ranked-start',this.started);
  }
  if(room.phase!=='results'||!this.started)return;
  const start=this.started;
  // Guest or duplicate-account rooms remain ordinary, unrated games.
  if(start.players.length>=2&&start.players.every(p=>p.accountId)&&new Set(start.players.map(p=>p.accountId)).size===start.players.length){
   if(!await this.storage.get('completed:'+start.id)){
   const states=[...room.members.values()].map(m=>m.state);
   const bestScore=Math.max(...states.filter(s=>!s.forfeited).map(s=>s.score));
   const receipt:MatchReceipt={id:start.id,mode:start.mode,startedAt:start.startedAt,finishedAt:Math.floor(Date.now()/1000),players:start.players.map(p=>{
    const state=states.find(s=>s.id===p.id),forfeit=!state||state.forfeited;
    const placement=start.mode==='blitz'?1+states.filter(s=>!s.forfeited&&s.score>(state?.score??0)).length:(state?.placement||start.players.length);
    return {accountId:p.accountId,placement,outcome:forfeit?'forfeit':room.winnerId===null?(start.mode!=='blitz'||state?.score===bestScore?'draw':'loss'):room.winnerId===p.id?'win':'loss'};
   })};
   // The receipt survives restarts and room expiry; write before publishing results.
   await this.storage.put({['outbox:'+receipt.id]:receipt,['completed:'+receipt.id]:true});
   }
   await this.storage.setAlarm(Date.now()+1000);
  }
  this.started=undefined;await this.storage.delete('ranked-start');
 }
 async deliver():Promise<boolean>{
  const pending=await this.storage.list<MatchReceipt>({prefix:'outbox:'});
  for(const [key,receipt] of pending){try{await new Rankings(this.db).settle(receipt);await this.storage.delete(key);}catch{return false;}}
  return true;
 }
}
