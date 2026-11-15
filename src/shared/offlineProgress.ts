import { dailySeed } from "./modes";
import type { RandomSource } from "./ruleEngine";
export interface RunResult { time: number; score: number; events: number }
export interface SurvivalRecord { games: number; totalTime: number; totalScore: number; totalEvents: number; bestTime: number; bestScore: number; bestEvents: number }
export interface DailyResult extends RunResult { date: string; seed: number; scenarioVersion: 1; attempts: number; completed: boolean; rewarded: boolean; bestCompleted?: RunResult }
export interface OfflineProgress { survival: SurvivalRecord; daily: DailyResult[]; localDailyMedals: number }
export const blankProgress=():OfflineProgress=>({survival:{games:0,totalTime:0,totalScore:0,totalEvents:0,bestTime:0,bestScore:0,bestEvents:0},daily:[],localDailyMedals:0});
export const DAILY_SECONDS=90;
export function utcDay(date=new Date()): string { return date.toISOString().slice(0,10); }
export function dailySpec(date=new Date()) {const day=utcDay(date);return {date:day,seed:dailySeed(new Date(`${day}T00:00:00Z`)),scenarioVersion:1 as const,seconds:DAILY_SECONDS};}
export function seededRandom(seed: number):RandomSource {
  let state=seed>>>0;
  const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const between=(min:number,max:number)=>min+Math.floor(next()*(max-min+1));
  return {between,pick:values=>values[between(0,values.length-1)],shuffle:values=>{
    const result=[...values];for(let i=result.length-1;i>0;i--){const j=between(0,i);[result[i],result[j]]=[result[j],result[i]];}return result;
  }};
}
const number=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)&&value>=0?Math.min(value,1e12):0;
export function readProgress(raw:unknown):OfflineProgress {
  const clean=blankProgress();
  if(!raw||typeof raw!=="object") return clean;
  const value=raw as Partial<OfflineProgress>;
  for(const key of Object.keys(clean.survival) as (keyof SurvivalRecord)[]) clean.survival[key]=number(value.survival?.[key]);
  if(Array.isArray(value.daily)) for(const row of value.daily.slice(-366)) {
    if(!row||typeof row.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||Number.isNaN(Date.parse(`${row.date}T00:00:00Z`))||utcDay(new Date(`${row.date}T00:00:00Z`))!==row.date||clean.daily.some(r=>r.date===row.date)) continue;
    clean.daily.push({date:row.date,seed:dailySpec(new Date(`${row.date}T00:00:00Z`)).seed,scenarioVersion:1,attempts:Math.floor(number(row.attempts)),completed:row.completed===true,rewarded:row.rewarded===true,time:number(row.time),score:Math.floor(number(row.score)),events:Math.floor(number(row.events))});
    if(row.bestCompleted) clean.daily.at(-1)!.bestCompleted={time:Math.min(90,number(row.bestCompleted.time)),score:Math.floor(number(row.bestCompleted.score)),events:Math.floor(number(row.bestCompleted.events))};
  }
  clean.localDailyMedals=Math.floor(number(value.localDailyMedals));return clean;
}
export function recordSurvival(progress:OfflineProgress,result:RunResult):void {
  const s=progress.survival;s.games++;s.totalTime+=result.time;s.totalScore+=result.score;s.totalEvents+=result.events;
  s.bestTime=Math.max(s.bestTime,result.time);s.bestScore=Math.max(s.bestScore,result.score);s.bestEvents=Math.max(s.bestEvents,result.events);
}
export function recordDaily(progress:OfflineProgress,spec:ReturnType<typeof dailySpec>,result:RunResult,completed:boolean):boolean {
  completed=completed&&result.time>=spec.seconds;
  let row=progress.daily.find(r=>r.date===spec.date);
  if(!row) {row={...result,date:spec.date,seed:spec.seed,scenarioVersion:1,attempts:0,completed:false,rewarded:false};progress.daily.push(row);}
  row.attempts++;row.time=Math.max(row.time,result.time);row.score=Math.max(row.score,result.score);row.events=Math.max(row.events,result.events);row.completed ||= completed;
  if(completed&&(!row.bestCompleted||result.score>row.bestCompleted.score)) row.bestCompleted={...result,time:spec.seconds};
  const reward=completed&&!row.rewarded;if(reward){row.rewarded=true;progress.localDailyMedals++;}
  progress.daily.sort((a,b)=>a.date.localeCompare(b.date));progress.daily=progress.daily.slice(-366);return reward;
}
export function survivalDifficulty(time:number) {
  const seconds=Math.max(0,time);
  return {tier:seconds>=60?2:seconds>=30?1:0,pressure:1+.15*(1-Math.exp(-seconds/180)),rest:Math.max(.25,.8/(1+seconds/60)),comboChance:Math.min(45,20+seconds/6)};
}
export function offlineFinished(mode:string,time:number,hp:number):boolean {return hp<=0||((mode==="daily"||mode==="blitz")&&time>=DAILY_SECONDS);}
