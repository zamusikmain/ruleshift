import { OFFLINE_MODES, ONLINE_MODES, type OfflineMode, type OnlineMode } from "./modes";
import type { RoomSnapshot } from "./protocol";
export interface PersonalRecord {
  games:number; bestTime:number; bestScore:number; bestEvents:number;
  bestPerfects:number; bestCombos:number; totalEvents:number; cleanBlitz:boolean;
}
export interface OnlineStats extends PersonalRecord {
  wins:number; losses:number; draws:number; streak:number; bestStreak:number;
}
export interface Progression {
  xp:number;
  offline:Record<OfflineMode,PersonalRecord>;
  online:Record<OnlineMode,OnlineStats>;
  // Server-issued participant IDs scope monotonic match numbers across reconnects.
  onlineCursors:Record<string,number>;
  offlineRuns:string[];
  dailyAwards:string[];
}
const record=():PersonalRecord=>({games:0,bestTime:0,bestScore:0,bestEvents:0,bestPerfects:0,bestCombos:0,totalEvents:0,cleanBlitz:false});
export function blankProgression():Progression {
  return {xp:0,offline:Object.fromEntries(OFFLINE_MODES.map(m=>[m,record()])) as Progression["offline"],
    online:Object.fromEntries(ONLINE_MODES.map(m=>[m,{...record(),wins:0,losses:0,draws:0,streak:0,bestStreak:0}])) as Progression["online"],
    onlineCursors:{},offlineRuns:[],dailyAwards:[]};
}
const validNumber=(n:unknown)=>typeof n==="number"&&Number.isFinite(n)&&n>=0?Math.min(n,1e9):0;
export function readProgression(raw:unknown):Progression {
  const p=blankProgression();if(!raw||typeof raw!=="object")return p;
  const value=raw as Progression;p.xp=Math.floor(validNumber(value.xp));
  for(const group of ["offline","online"] as const) for(const mode of Object.keys(p[group])) {
    const target=(p[group] as Record<string,PersonalRecord>)[mode];
    const source=(value[group] as Record<string,PersonalRecord>|undefined)?.[mode];
    for(const key of Object.keys(target)) {
      if(key==="cleanBlitz") target.cleanBlitz=source?.cleanBlitz===true;
      else (target as unknown as Record<string,number>)[key]=validNumber((source as unknown as Record<string,unknown>)?.[key]);
    }
  }
  for(const s of Object.values(p.online)) {
    s.wins=Math.floor(s.wins);s.losses=Math.floor(s.losses);s.draws=Math.floor(s.draws);
    s.games=s.wins+s.losses+s.draws;s.streak=Math.min(s.streak,s.wins);s.bestStreak=Math.min(Math.max(s.streak,s.bestStreak),s.wins);
  }
  if(value.onlineCursors&&typeof value.onlineCursors==="object") for(const [key,n] of Object.entries(value.onlineCursors).slice(0,4096)) {
    if(/^[A-Z2-9]{6}:[a-zA-Z0-9-]{1,64}$/.test(key)&&Number.isSafeInteger(n)&&n>=1)
      p.onlineCursors[key]=n;
  }
  for(const field of ["offlineRuns","dailyAwards"] as const) if(Array.isArray(value[field]))
    p[field]=[...new Set(value[field].filter(v=>typeof v==="string"&&v.length<=80))].slice(-8192);
  return p;
}
export function levelProgress(xp:number) {
  // Increasing cost, capped UI level; XP has no server or economic value.
  const level=Math.min(100,1+Math.floor(Math.sqrt(Math.max(0,xp)/100)));
  const start=(level-1)**2*100,next=level===100?start:level**2*100;
  return {level,current:level===100?0:xp-start,required:next-start};
}
export interface RunMetrics {time:number;score:number;events:number;perfects:number;combos:number;damage:number}
export interface ProgressNotice {xp:number;levelUp:boolean;record:boolean}
function updateRecord(target:PersonalRecord,run:RunMetrics,cleanBlitz=false):boolean {
  const fresh=run.time>target.bestTime||run.score>target.bestScore||run.events>target.bestEvents;
  target.games++;target.totalEvents+=run.events;
  target.bestTime=Math.max(target.bestTime,run.time);target.bestScore=Math.max(target.bestScore,run.score);
  target.bestEvents=Math.max(target.bestEvents,run.events);target.bestPerfects=Math.max(target.bestPerfects,run.perfects);
  target.bestCombos=Math.max(target.bestCombos,run.combos);target.cleanBlitz ||= cleanBlitz;
  return fresh;
}
function grant(p:Progression,xp:number,fresh:boolean):ProgressNotice {
  const before=levelProgress(p.xp).level;p.xp=Math.min(1e9,p.xp+xp);
  return {xp,levelUp:levelProgress(p.xp).level>before,record:fresh};
}
const earned=(r:RunMetrics)=>r.time>=20&&r.events>=2?Math.min(200,r.events*10+r.perfects*5+r.combos*5):0;
export function recordOffline(p:Progression,key:string,mode:OfflineMode,run:RunMetrics,finished:boolean,completedDaily=false,date=""):ProgressNotice|null {
  if(!key||p.offlineRuns.includes(key))return null;
  p.offlineRuns.push(key);p.offlineRuns=p.offlineRuns.slice(-8192);
  const fresh=updateRecord(p.offline[mode],run,mode==="blitz"&&finished&&run.time>=90&&run.damage===0);
  let xp=finished?earned(run):0;
  if(mode==="daily") {
    xp=0;
    if(completedDaily&&finished&&run.time>=90&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&!p.dailyAwards.includes(date)) {
      if(p.dailyAwards.length<8192){p.dailyAwards.push(date);xp=earned(run);}
    }
  }
  return grant(p,xp,fresh);
}
export interface AuthoritativeResult extends RunMetrics {
  cleanRules:number;
  participantKey:string;matchId:number;mode:OnlineMode;outcome:"win"|"loss"|"draw";forfeited:boolean;
}
/** Call only with a snapshot received from the game Worker, never client input. */
export function resultFromSnapshot(state:RoomSnapshot,id:string):AuthoritativeResult|null {
  const me=state.players.find(p=>p.id===id);
  if(!me||state.matchId<1||state.phase==="countdown"||state.phase==="lobby"||(!me.forfeited&&state.phase!=="results"))return null;
  return {participantKey:`${state.code}:${id}`,matchId:state.matchId,mode:state.mode,
    outcome:me.forfeited?"loss":state.winnerId===id?"win":state.winnerId===null?"draw":"loss",forfeited:me.forfeited===true,
    time:me.eliminatedAt??state.time,score:me.score,events:me.eventsSurvived??me.rules,cleanRules:me.rules,perfects:me.perfects,combos:me.chaos,damage:me.damageTaken};
}
export function recordOnline(p:Progression,r:AuthoritativeResult):ProgressNotice|null {
  if((p.onlineCursors[r.participantKey]??0)>=r.matchId)return null;
  if(!(r.participantKey in p.onlineCursors)&&Object.keys(p.onlineCursors).length>=4096)return null; // Fail closed; do not evict replay protection.
  p.onlineCursors[r.participantKey]=r.matchId;
  const s=p.online[r.mode],fresh=updateRecord(s,r);
  if(r.outcome==="win"){s.wins++;s.streak++;s.bestStreak=Math.max(s.bestStreak,s.streak);}
  else {s[r.outcome==="loss"?"losses":"draws"]++;s.streak=0;}
  return grant(p,r.forfeited?0:earned(r),fresh);
}
export const winRate=(s:OnlineStats)=>s.games?Math.round(100*s.wins/s.games):0;
