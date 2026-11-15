import { ARENA, center } from "../config";
import { lineDistance, type Point, type LaserPlayer } from "./laserHazards";
import type { OfflineMode, OnlineMode } from "./modes";

export interface Explosion extends Point {
  born: number;
  impact: number;
  duration: number;
  radius: number;
  secondary: boolean;
}
export interface Wave extends Point {
  born: number;
  impact: number;
  speed: number;
  inner: number;
  outer: number;
  width: number;
  gap: number;
  halfGap: number;
}
export interface BurstLayout {
  kind: "madness" | "shockwave";
  warning: number;
  explosions: Explosion[];
  waves: Wave[];
  safe: Point[];
}
export interface BurstRandom { between(min: number, max: number): number }
export const angleDifference = (a: number, b: number): number => Math.atan2(Math.sin(a-b),Math.cos(a-b));
export const waveRadius = (w: Wave, time: number): number => w.inner+Math.max(0,time-w.impact)*w.speed;

// Distance to the finite circular front, including the two ends of its gap.
export function waveDistance(w: Wave, p: Point, radius: number): number {
  const angle=Math.atan2(p.y-w.y,p.x-w.x);
  if (Math.abs(angleDifference(angle,w.gap))>=w.halfGap)
    return Math.abs(Math.hypot(p.x-w.x,p.y-w.y)-radius);
  return Math.min(...[w.gap-w.halfGap,w.gap+w.halfGap].map(a=>
    Math.hypot(p.x-w.x-Math.cos(a)*radius,p.y-w.y-Math.sin(a)*radius)));
}
export function burstContact(layout: BurstLayout, p: LaserPlayer, time: number, dt=0, previous: Point=p): boolean {
  const at=(t: number): Point => {
    const f=dt>0?Math.max(0,Math.min(1,(t-time+dt)/dt)):1;
    return {x:previous.x+(p.x-previous.x)*f,y:previous.y+(p.y-previous.y)*f};
  };
  for (const e of layout.explosions) {
    const from=Math.max(time-dt,e.impact),to=Math.min(time,e.impact+e.duration);
    if (from>to || time<e.impact) continue;
    const a=at(from),b=at(to);
    if (lineDistance(e,{x1:a.x,y1:a.y,x2:b.x,y2:b.y})<=e.radius+p.radius) return true;
  }
  for (const w of layout.waves) {
    const from=Math.max(time-dt,w.impact),to=Math.min(time,w.impact+(w.outer-w.inner)/w.speed);
    if(from>to || time<w.impact) continue;
    const a=at(from),b=at(to),travel=Math.hypot(b.x-a.x,b.y-a.y)+w.speed*(to-from);
    const steps=Math.max(1,Math.ceil(travel/2));
    // Inflated sampling bounds relative motion by 1px, including gap endpoints.
    for(let i=0;i<=steps;i++) {
      const t=from+(to-from)*i/steps;
      if(waveDistance(w,at(t),waveRadius(w,t))<=p.radius+w.width/2+travel/steps/2) return true;
    }
  }
  return false;
}

// A refuge is safe for the ENTIRE schedule, including all secondary explosions.
// Before the first impact the straight path is unobstructed. Reaction and
// acceleration reserve never assumes Dash, pickups or another player's help.
export function burstRefuge(layout: BurstLayout, p: LaserPlayer, inset: number): Point | undefined {
  const left=ARENA.left+inset+p.radius+8,right=ARENA.right-inset-p.radius-8;
  const top=ARENA.top+inset*.6+p.radius+8,bottom=ARENA.bottom-inset*.6-p.radius-8;
  let nearest: Point|undefined,best=Infinity;
  const reach=265*Math.max(0,layout.warning-.3-.1);
  for(let x=left;x<=right;x+=12) for(let y=top;y<=bottom;y+=12) {
    const d=Math.hypot(x-p.x,y-p.y);
    if(d>reach || d>=best) continue;
    const q={x,y};
    if(layout.explosions.some(e=>Math.hypot(x-e.x,y-e.y)<=e.radius+p.radius+10)) continue;
    if(layout.waves.some(w=>{
      const r=Math.hypot(x-w.x,y-w.y),margin=p.radius+w.width/2+10;
      if(r<w.inner-margin || r>w.outer+margin) return false;
      const gap=w.halfGap-Math.abs(angleDifference(Math.atan2(y-w.y,x-w.x),w.gap));
      return gap<=0 || r*Math.sin(Math.min(Math.PI/2,gap))<=margin;
    })) continue;
    if(d<best) {best=d;nearest=q;}
  }
  return nearest;
}

export function makeBurstLayout(kind: BurstLayout["kind"], players: LaserPlayer[], tier: number,
  mode: OfflineMode|OnlineMode, duration: number, inset: number, random: BurstRandom): BurstLayout|undefined {
  const living=players.filter(p=>p.hp>0);
  if(!living.length) return undefined;
  const level=Math.max(0,Math.min(2,tier)),fast=mode==="blitz"||mode==="chaos";
  const warning=1.35;
  // Bounded attempts and bounded schedule: generation and drawing stay inexpensive.
  for(let attempt=0;attempt<6;attempt++) {
    const layout: BurstLayout={kind,warning,explosions:[],waves:[],safe:[]};
    const count=2+level+(fast?1:0);
    if(kind==="madness") {
      for(let wave=0;wave<count;wave++) {
        const impact=warning+wave*(duration-warning-.65)/(count-1);
        for(let i=0;i<2+level;i++) {
          const x=random.between(ARENA.left+60,ARENA.right-60),y=random.between(ARENA.top+60,ARENA.bottom-60);
          const lead=.9+(i%3)*.2,radius=26+(i%3)*10+level*4;
          layout.explosions.push({x,y,born:Math.max(0,impact-lead),impact,duration:.2,radius,secondary:false});
          if(i%2===0) layout.explosions.push({x:x+30,y:y+20,born:impact-.15,impact:impact+.35,duration:.2,radius:radius*.7,secondary:true});
        }
      }
    } else {
      const gap=random.between(0,359)*Math.PI/180;
      const speed=(fast?430:320)+level*55;
      const lifetime=Math.min(.75,(duration-warning-.1)/2);
      for(let i=0;i<count;i++) layout.waves.push({...center,born:0,
        impact:warning+i*(duration-warning-lifetime-.05)/(count-1),
        speed,inner:40,outer:40+speed*lifetime,width:8,gap,halfGap:Math.PI/3});
    }
    for(const p of living) {
      const q=burstRefuge(layout,p,inset+duration*1.5);
      if(!q) break;
      layout.safe.push(q);
    }
    if(layout.safe.length===living.length) return layout;
  }
  return undefined;
}
