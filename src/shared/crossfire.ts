import { ARENA } from "../config";
import { lineDistance, type Point, type LaserPlayer, type Segment } from "./laserHazards";
import type { OfflineMode, OnlineMode } from "./modes";
export interface CrossAttack {
  direction: "TOP"|"BOTTOM"|"LEFT"|"RIGHT";
  active: number;
  end: number;
  speed: number;
  width: number;
  gap: number;
  halfGap: number;
}
export interface CrossPhase { warning: number; active: number; end: number; safe: Point[] }
export interface Crossfire { attacks: CrossAttack[]; phases: CrossPhase[] }
const clamp=(n: number,a: number,b: number)=>Math.max(a,Math.min(b,n));
export function crossSegments(a: CrossAttack,time: number): Segment[] {
  const distance=Math.max(0,time-a.active)*a.speed;
  if(a.direction==="TOP"||a.direction==="BOTTOM") {
    const y=a.direction==="TOP"?ARENA.top-30+distance:ARENA.bottom+30-distance;
    return [{x1:ARENA.left,y1:y,x2:a.gap-a.halfGap,y2:y},{x1:a.gap+a.halfGap,y1:y,x2:ARENA.right,y2:y}];
  }
  const x=a.direction==="LEFT"?ARENA.left-30+distance:ARENA.right+30-distance;
  return [{x1:x,y1:ARENA.top,x2:x,y2:a.gap-a.halfGap},{x1:x,y1:a.gap+a.halfGap,x2:x,y2:ARENA.bottom}];
}
export function crossContact(layout: Crossfire,p: LaserPlayer,time: number,dt=0,previous: Point=p): boolean {
  for(const a of layout.attacks) {
    const from=Math.max(time-dt,a.active),to=Math.min(time,a.end);
    if(from>to||time<a.active) continue;
    const distance=Math.hypot(p.x-previous.x,p.y-previous.y);
    const steps=Math.max(1,Math.ceil((a.speed*(to-from)+distance)/2));
    const margin=(a.speed*(to-from)+distance)/steps/2;
    for(let i=0;i<=steps;i++) {
      const t=from+(to-from)*i/steps,f=dt>0?clamp((t-time+dt)/dt,0,1):1;
      const q={x:previous.x+(p.x-previous.x)*f,y:previous.y+(p.y-previous.y)*f};
      if(crossSegments(a,t).some(l=>lineDistance(q,l)<=p.radius+a.width/2+margin)) return true;
    }
  }
  return false;
}
export function makeCrossfire(players: LaserPlayer[],tier: number,mode: OfflineMode|OnlineMode,inset: number,rotation: number): Crossfire|undefined {
  const living=players.filter(p=>p.hp>0);if(!living.length) return undefined;
  const future=inset+6.5*1.5,left=ARENA.left+future+70,right=ARENA.right-future-70;
  const top=ARENA.top+future*.6+70,bottom=ARENA.bottom-future*.6-70;
  if(right-left<160||top>=bottom) return undefined;
  const x=clamp(living.reduce((sum,p)=>sum+p.x,0)/living.length,left,right-150);
  const y=clamp(living.reduce((sum,p)=>sum+p.y,0)/living.length,top,bottom);
  const layout: Crossfire={attacks:[],phases:[]};
  const directions=(["TOP","LEFT","BOTTOM","RIGHT"] as const);
  let previous=living.map(p=>({x:p.x,y:p.y}));
  let warning=0;
  for(let phase=0;phase<2;phase++) {
    const active=warning+1.3,safe: Point[]=[];
    for(let i=0;i<living.length;i++) {
      const p=living[i],margin=p.radius+20;
      if(margin>=60) return undefined;
      const q={x:clamp(previous[i].x,x+phase*150-60+margin,x+phase*150+60-margin),y:clamp(previous[i].y,y-60+margin,y+60-margin)};
      // Entire transit occurs after prior attacks expire, before the next front.
      if(Math.hypot(q.x-previous[i].x,q.y-previous[i].y)>265*(1.3-.4)) return undefined;
      safe.push(q);
    }
    for(let i=0;i<2;i++) {
      const direction=directions[(phase*2+i+rotation)%4];
      const speed=780+Math.min(2,tier)*120+(mode==="blitz"||mode==="chaos"?80:0)+i*70;
      const start=active+(phase===1&&i===1?.15:0);
      const span=direction==="TOP"||direction==="BOTTOM"?ARENA.bottom-ARENA.top:ARENA.right-ARENA.left;
      layout.attacks.push({direction,active:start,end:start+(span+60)/speed,speed,width:10+Math.min(2,tier)*5+i*3,
        gap:direction==="TOP"||direction==="BOTTOM"?x+phase*150:y,halfGap:60});
    }
    const end=Math.max(...layout.attacks.slice(-2).map(a=>a.end));
    layout.phases.push({warning,active,end,safe});previous=safe;warning=end;
  }
  return layout;
}
