import { ARENA, center } from '../config';
import { lineDistance, type Point, type Segment } from './laserHazards';
import type { Body } from './movement';
import type { OfflineMode, OnlineMode } from './modes';
export const OVERDRIVE_KINDS = ['chainLightning','gravityPulse','movingWalls','minefield','orbitalStrike','blackHole','bulletStorm','arenaSplit'] as const;
export type OverdriveKind = typeof OVERDRIVE_KINDS[number];
export interface Threat { shape:'line'|'disc'; a:Point; b:Point; radius:number; warning:number; active:number; end:number; velocity:Point; force?:number; pulse?:boolean; armed?:number }
export interface Overdrive { kind:OverdriveKind; threats:Threat[]; safe:Point[]; warning:number; duration:number }
interface Player extends Point { hp:number; radius:number }
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function threatSegment(h:Threat,time:number):Segment {
 const travel=clamp(time-h.active,0,h.end-h.active);
 return {x1:h.a.x+h.velocity.x*travel,y1:h.a.y+h.velocity.y*travel,x2:h.b.x+h.velocity.x*travel,y2:h.b.y+h.velocity.y*travel};
}
function threatDistance(h:Threat,p:Point,time:number):number {
 const l=threatSegment(h,time);
 return h.shape==='line'?lineDistance(p,l):Math.hypot(p.x-l.x1,p.y-l.y1);
}
export function overdriveContact(layout:Overdrive,p:Player,time:number,dt=0,previous:Point=p):boolean {
 for(const h of layout.threats) {
  if(h.force!==undefined || time<h.active || time-dt>h.end) continue;
  const from=Math.max(time-dt,h.active),to=Math.min(time,h.end);
  const travel=Math.hypot(h.velocity.x,h.velocity.y)*(to-from)+Math.hypot(p.x-previous.x,p.y-previous.y);
  const steps=Math.max(1,Math.ceil(travel/3)),margin=travel/steps/2;
  for(let i=0;i<=steps;i++) {
   const t=from+(to-from)*i/steps,f=dt>0?clamp((t-time+dt)/dt,0,1):1;
   const q={x:previous.x+(p.x-previous.x)*f,y:previous.y+(p.y-previous.y)*f};
   if(threatDistance(h,q,t)<=p.radius+h.radius+margin) return true;
  }
 }
 return false;
}
// This is a conservative swept-volume certificate, not just sampled safe frames.
export function overdriveSafe(layout:Overdrive,q:Point,radius:number):boolean {
 return layout.threats.every(h=>{
  const from=threatSegment(h,h.active),to=threatSegment(h,h.end);
  if(h.shape==='disc') return lineDistance(q,{x1:from.x1,y1:from.y1,x2:to.x1,y2:to.y1})>radius+h.radius+12;
  // Lines only translate perpendicular to themselves. Their swept AABB contains
  // the complete wall/discharge and is deliberately wider than exact geometry.
  const left=Math.min(from.x1,from.x2,to.x1,to.x2),right=Math.max(from.x1,from.x2,to.x1,to.x2);
  const top=Math.min(from.y1,from.y2,to.y1,to.y2),bottom=Math.max(from.y1,from.y2,to.y1,to.y2);
  return Math.hypot(q.x-clamp(q.x,left,right),q.y-clamp(q.y,top,bottom))>radius+h.radius+12;
 });
}
export function makeOverdrive(kind:OverdriveKind,players:Player[],tier:number,mode:OfflineMode|OnlineMode,inset:number,rotation:number):Overdrive|undefined {
 const fast=mode==='blitz'||mode==='chaos',level=clamp(tier,0,2);
 const layout:Overdrive={kind,threats:[],safe:[],warning:2.4,duration:6.8};
 const add=(shape:Threat['shape'],a:Point,b:Point,radius:number,active:number,end:number,velocity:Point={x:0,y:0},force?:number,pulse?:boolean)=>layout.threats.push({shape,a,b,radius,warning:Math.max(0,active-2.4),active,end,velocity,force,pulse});
 const pivot={x:center.x+(rotation%3-1)*90,y:center.y};
 if(kind==='chainLightning') {
  const nodes=[{x:pivot.x-170,y:pivot.y-115},{x:pivot.x,y:pivot.y+100},{x:pivot.x+170,y:pivot.y-115}];
  // Branches discharge in order, then the network closes; nodes are also live.
  for(let wave=0;wave<2;wave++) for(let i=0;i<3;i++) {
   const a=2.4+wave*1.65+i*.28,b=nodes[(i+1)%3];
   add('line',nodes[i],b,6+level*2,a,a+.32);
   add('disc',nodes[i],nodes[i],20,a,a+.32);
  }
 } else if(kind==='gravityPulse'||kind==='blackHole') {
  if(kind==='gravityPulse') for(let i=0;i<3+level;i++) {
   const active=2.4+i*.65;add('disc',pivot,pivot,155,active,active+.3,{x:0,y:0},110,true);
  } else {
   add('disc',pivot,pivot,170,2.4,6.3,{x:0,y:0},-95);
   add('disc',pivot,pivot,30,2.4,6.3);
  }
 } else if(kind==='movingWalls') {
  const speed=75+level*15+(fast?15:0),gap=pivot.y,halfGap=68;
  for(const [x,sign] of [[pivot.x-240,1],[pivot.x+240,-1]]) {
   add('line',{x,y:ARENA.top},{x,y:gap-halfGap},10,2.4,5.8,{x:sign*speed,y:0});
   add('line',{x,y:gap+halfGap},{x,y:ARENA.bottom},10,2.4,5.8,{x:sign*speed,y:0});
  }
 } else if(kind==='minefield') {
  // A visible fuse ignites each linked neighbour with a staggered chain delay.
  for(let i=0;i<5+level;i++) {
   const a={x:pivot.x-200+i*65,y:pivot.y+(i%2?25:-25)},active=4.7+i*.24;
   add('disc',a,a,44+level*4,active,active+.45);
   layout.threats.at(-1)!.warning=0;
   layout.threats.at(-1)!.armed=2.4;
  }
 } else if(kind==='orbitalStrike') {
  // Lock actual player positions once; never silently retarget after warning.
  for(const p of players.filter(p=>p.hp>0)) {
   const a={x:p.x,y:p.y};
   add('disc',a,a,40+level*5,2.4,3.2);
   add('line',{x:a.x-40,y:a.y},{x:a.x+40,y:a.y},8,4.4,5.4,{x:0,y:(rotation%2?1:-1)*90});
  }
 } else if(kind==='bulletStorm') {
  const speed=290+level*45+(fast?50:0),gap=pivot.y;
  for(let wave=0;wave<3;wave++) for(let y=ARENA.top+20;y<ARENA.bottom;y+=42) {
   if(Math.abs(y-gap)<75) continue;
   const a={x:ARENA.left-20,y};const active=2.4+wave*.55;
   add('disc',a,a,7+level,active,Math.min(6.7,active+(ARENA.right-ARENA.left+40)/speed),{x:speed,y:0});
  }
 } else {
  // Fixed dividing barriers have two staggered activation phases and an open
  // crossing. Unlike Moving Walls, these change connectivity without translation.
  const gap=pivot.y,halfGap=70;
  for(let i=0;i<2;i++) {
   const x=pivot.x+(i?130:-130),active=2.4+i*1.6;
   add('line',{x,y:ARENA.top},{x,y:gap-halfGap},14,active,6.3);
   add('line',{x,y:gap+halfGap},{x,y:ARENA.bottom},14,active,6.3);
  }
 }
 const alive=players.filter(p=>p.hp>0);if(!alive.length) return undefined;
 const future=inset+layout.duration*1.5;
 for(const p of alive) {
  let best=Infinity,q:Point|undefined;
  // .3 reaction, existing dash/boost drift and reversal reserve. Escape never
  // requires a ready Dash. Entire straight transit finishes before first damage.
  const reach=265*(layout.warning-1.2);
  for(let x=ARENA.left+future+p.radius+12;x<ARENA.right-future-p.radius-12;x+=16)
   for(let y=ARENA.top+future*.6+p.radius+12;y<ARENA.bottom-future*.6-p.radius-12;y+=16) {
    const candidate={x,y},d=Math.hypot(p.x-x,p.y-y);
    if(d<best&&d<=reach&&overdriveSafe(layout,candidate,p.radius)){best=d;q=candidate;}
   }
  if(!q) return undefined;layout.safe.push(q);
 }
 return layout;
}
// Proximity can ignite a mine's visible fuse early. Adjacent mines inherit a
// delayed chain fuse; no client can choose an explosion or its timing.
export function updateOverdrive(layout:Overdrive,players:Player[],time:number):void {
 if(layout.kind!=='minefield') return;
 for(const [index,h] of layout.threats.entries()) {
  if(h.armed===undefined||time<h.armed||time+.8>=h.active) continue;
  if(!players.some(p=>p.hp>0&&Math.hypot(p.x-h.a.x,p.y-h.a.y)<p.radius+18)) continue;
  for(let i=0;i<layout.threats.length;i++) {
   const mine=layout.threats[i],activation=time+.8+Math.abs(i-index)*.24;
   if(activation<mine.active) {mine.active=activation;mine.end=activation+.45;}
  }
 }
}
export function applyOverdriveMotion(layout:Overdrive|Overdrive[]|undefined,body:Body,time:number,dt:number,previous:Point=body):void {
 if(Array.isArray(layout)) {for(const layer of layout)applyOverdriveMotion(layer,body,time,dt,previous);return;}
 if(!layout||body.hp<=0) return;
 if(layout.kind==='movingWalls'||layout.kind==='arenaSplit') {
  for(const h of layout.threats) {
   if(time<h.active||time-dt>h.end) continue;
   if(!overdriveContact({...layout,threats:[h]},body,time,dt,previous)) continue;
   const line=threatSegment(h,time),before=threatSegment(h,Math.max(h.active,time-dt));
   const side=previous.x<before.x1?-1:1;
   // Solid barriers stop crossing even during Dash. Touch still reaches the
   // shared damage callback, which retains Shield/invulnerability rules.
   body.x=clamp(line.x1+side*(body.radius+h.radius-.05),ARENA.left+body.radius,ARENA.right-body.radius);
   body.vx=0;
  }
 }
 for(const h of layout.threats) {
  if(h.force===undefined||time<h.active||time>=h.end) continue;
  const dx=body.x-h.a.x,dy=body.y-h.a.y,d=Math.hypot(dx,dy);
  if(d>=h.radius||d<.001) continue;
  const strength=h.force*(1-d/h.radius),x=dx/d*strength*dt,y=dy/d*strength*dt;
  body.x=clamp(body.x+x,ARENA.left+body.radius,ARENA.right-body.radius);
  body.y=clamp(body.y+y,ARENA.top+body.radius,ARENA.bottom-body.radius);
  body.distance+=Math.hypot(x,y);
 }
}
