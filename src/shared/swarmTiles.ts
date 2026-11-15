import { ARENA, center } from "../config";
import { lineDistance, type Point, type LaserPlayer } from "./laserHazards";
import type { OfflineMode, OnlineMode } from "./modes";

export interface SwarmPlayer extends LaserPlayer { id: string }
export interface Pursuer extends Point {
  previous: Point;
  radius: number;
  speed: number;
  model: "chase" | "intercept" | "patrol";
  target: string;
  patrol: Point;
}
export interface Tile { x: number; y: number; width: number; height: number; born: number; active: number; end: number }
export interface SwarmTiles {
  kind: "swarm" | "tiles";
  warning: number;
  safe: Point[];
  refugeRadius: number;
  aggression: number;
  hunters: Pursuer[];
  tiles: Tile[];
  pattern: "stripes" | "checker" | "waves" | "random";
  phases?: { warning: number; active: number; end: number; safe: Point[] }[];
}
export interface HazardRandom { between(min: number,max: number): number }
const clamp=(n: number,min: number,max: number)=>Math.max(min,Math.min(max,n));
export function tileDistance(p: Point,t: Tile): number {
  return Math.hypot(p.x-clamp(p.x,t.x,t.x+t.width),p.y-clamp(p.y,t.y,t.y+t.height));
}

// Swarm refuges persist; tile refuges change after a complete wave ends.
// Transit has its own reaction/acceleration budget and no active tiles.
// Both use bounds reserved for the entire event's arena contraction.
export function makeSwarmTiles(kind: SwarmTiles["kind"], players: SwarmPlayer[], tier: number,
  mode: OfflineMode|OnlineMode,duration: number,inset: number,random: HazardRandom): SwarmTiles|undefined {
  const living=players.filter(p=>p.hp>0);
  if(!living.length) return undefined;
  const level=clamp(tier,0,2),fast=mode==="blitz"||mode==="chaos"||mode==="lastOneStanding";
  const future=inset+duration*1.5,margin=36;
  const left=ARENA.left+future+margin,right=ARENA.right-future-margin;
  const top=ARENA.top+future*.6+margin,bottom=ARENA.bottom-future*.6-margin;
  if(left>=right || top>=bottom) return undefined;
  const layout: SwarmTiles={kind,warning:1.25,safe:[],refugeRadius:32,aggression:.35+level*.15+(fast?.1:0),hunters:[],tiles:[],
    pattern:(["stripes","checker","waves","random"] as const)[random.between(0,3)]};
  for(const p of living) {
    if(p.radius>16) return undefined;
    const dx=center.x-p.x,dy=center.y-p.y,d=Math.hypot(dx,dy);
    const q={x:clamp(p.x+(d>80?dx/d*80:70),left,right),y:clamp(p.y+(d>80?dy/d*80:0),top,bottom)};
    // .3s reaction + .1s acceleration/reversal, ordinary 265px/s speed.
    if(Math.hypot(q.x-p.x,q.y-p.y)>265*(layout.warning-.4)) return undefined;
    layout.safe.push(q);
  }
  if(kind==="swarm") {
    const count=3+level+(fast?1:0),speed=100+level*25+(fast?25:0);
    const candidates: Point[]=[];
    for(let i=0;i<16;i++) {
      const a=i*Math.PI/8;
      const q={x:clamp(center.x+Math.cos(a)*(right-left)/2,left,right),y:clamp(center.y+Math.sin(a)*(bottom-top)/2,top,bottom)};
      if(layout.safe.every(s=>Math.hypot(s.x-q.x,s.y-q.y)>layout.refugeRadius+24)) candidates.push(q);
    }
    if(candidates.length<count) return undefined;
    const offset=random.between(0,candidates.length-1);
    for(let i=0;i<count;i++) {
      const q=candidates[(offset+Math.floor(i*candidates.length/count))%candidates.length];
      layout.hunters.push({...q,previous:{...q},radius:12,speed,model:(["chase","intercept","patrol"] as const)[i%3],
        target:living[i%living.length].id,patrol:{...candidates[(offset+i+3)%candidates.length]}});
    }
  } else {
    const width=(ARENA.right-ARENA.left)/6,height=(ARENA.bottom-ARENA.top)/4;
    const activeLength=.3+level*.1,stagger=.12-level*.02;
    layout.phases=[];
    let warning=0,previous=living.map(p=>({x:p.x,y:p.y}));
    for(let wave=0;wave<2;wave++) {
      const active=warning+1.25;
      const safe=living.map((_,i)=>({x:center.x+(wave===0?-80:80),y:clamp(previous[i].y,top,bottom)}));
      if(safe.some((q,i)=>q.x<left||q.x>right||Math.hypot(q.x-previous[i].x,q.y-previous[i].y)>265*(1.25-.4))) return undefined;
      for(let cell=0;cell<24;cell++) {
        const col=cell%6,row=Math.floor(cell/6);
        const group=layout.pattern==="stripes"?col%3:layout.pattern==="checker"?(col+row)%3:layout.pattern==="waves"?Math.floor(col/2):random.between(0,2);
        const start=active+group*stagger;
        const tile: Tile={x:ARENA.left+col*width,y:ARENA.top+row*height,width,height,born:warning,active:start,end:start+activeLength};
        if(safe.every(q=>tileDistance(q,tile)>layout.refugeRadius+24)) layout.tiles.push(tile);
      }
      const end=Math.max(...layout.tiles.filter(t=>t.born===warning).map(t=>t.end));
      if(end>duration) return undefined;
      layout.phases.push({warning,active,end,safe});previous=safe;warning=end;
    }
    layout.safe=layout.phases[0].safe;
    if(!layout.tiles.length) return undefined;
  }
  return layout;
}

export function updateSwarm(layout: SwarmTiles,players: SwarmPlayer[],previousPlayers: Map<string,Point>,time: number,dt: number): void {
  const living=players.filter(p=>p.hp>0);
  const loads=new Map(living.map(p=>[p.id,0]));
  for(const h of layout.hunters) {
    h.previous={x:h.x,y:h.y};
    // Rebalance each tick, preferring the existing target at equal load.
    const targets=[...living].sort((a,b)=>(loads.get(a.id)!-loads.get(b.id)!) || (a.id===h.target?-1:b.id===h.target?1:0));
    const target=targets[0];
    if(!target) {h.target="";continue;}
    h.target=target.id;loads.set(target.id,loads.get(target.id)!+1);
    if(time<layout.warning) continue;
    let destination: Point=target;
    const old=previousPlayers.get(target.id)??target;
    if(h.model==="intercept") destination={x:target.x+clamp((target.x-old.x)/Math.max(.001,dt),-265,265)*layout.aggression,y:target.y+clamp((target.y-old.y)/Math.max(.001,dt),-265,265)*layout.aggression};
    if(h.model==="patrol" && time<layout.warning+1.2/(.5+layout.aggression) && Math.hypot(target.x-h.x,target.y-h.y)>200+layout.aggression*80) destination=h.patrol;
    destination={x:clamp(destination.x,ARENA.left+h.radius,ARENA.right-h.radius),y:clamp(destination.y,ARENA.top+h.radius,ARENA.bottom-h.radius)};
    // Steer around the protected circles instead of repeatedly hitting them.
    const obstacle=layout.safe.find(q=>lineDistance(q,{x1:h.x,y1:h.y,x2:destination.x,y2:destination.y})<layout.refugeRadius+h.radius+8);
    if(obstacle) {
      const angle=Math.atan2(h.y-obstacle.y,h.x-obstacle.x)+(h.model==="patrol"?-1:1)*.35;
      const radius=layout.refugeRadius+h.radius+18;
      destination={x:obstacle.x+Math.cos(angle)*radius,y:obstacle.y+Math.sin(angle)*radius};
    }
    const dx=destination.x-h.x,dy=destination.y-h.y,d=Math.hypot(dx,dy);
    const step=Math.min(d,h.speed*Math.max(0,Math.min(dt,time-layout.warning)));
    if(!d) continue;
    let fraction=1;
    const end={x:h.x+dx/d*step,y:h.y+dy/d*step};
    // Clip the motion at the first refuge boundary; never jump through a refuge.
    for(const q of layout.safe) {
      const radius=layout.refugeRadius+h.radius+1;
      const mx=h.x-q.x,my=h.y-q.y,vx=end.x-h.x,vy=end.y-h.y;
      const a=vx*vx+vy*vy,b=2*(mx*vx+my*vy),c=mx*mx+my*my-radius*radius,disc=b*b-4*a*c;
      if(a>0 && disc>=0) {
        const entry=(-b-Math.sqrt(disc))/(2*a);
        if(entry>=0 && entry<=fraction) fraction=Math.max(0,entry-1e-5);
      }
    }
    if(fraction<.05) {
      const base=Math.atan2(dy,dx);
      for(const turn of [Math.PI/2,-Math.PI/2,Math.PI]) {
        const q={x:clamp(h.x+Math.cos(base+turn)*step,ARENA.left+h.radius,ARENA.right-h.radius),y:clamp(h.y+Math.sin(base+turn)*step,ARENA.top+h.radius,ARENA.bottom-h.radius)};
        if(Math.hypot(q.x-h.x,q.y-h.y)<.1) continue;
        if(layout.safe.every(s=>lineDistance(s,{x1:h.x,y1:h.y,x2:q.x,y2:q.y})>=layout.refugeRadius+h.radius+1)) {end.x=q.x;end.y=q.y;fraction=1;break;}
      }
    }
    h.x+=(end.x-h.x)*fraction;h.y+=(end.y-h.y)*fraction;
  }
}

export function swarmTilesContact(layout: SwarmTiles,p: LaserPlayer,time: number,dt: number,previous: Point=p): boolean {
  const at=(t: number)=>{const f=dt>0?clamp((t-time+dt)/dt,0,1):1;return {x:previous.x+(p.x-previous.x)*f,y:previous.y+(p.y-previous.y)*f};};
  if(layout.kind==="swarm") {
    if(time<layout.warning) return false;
    const start=at(Math.max(time-dt,layout.warning));
    return layout.hunters.some(h=>lineDistance({x:0,y:0},{x1:start.x-h.previous.x,y1:start.y-h.previous.y,x2:p.x-h.x,y2:p.y-h.y})<=p.radius+h.radius);
  }
  return layout.tiles.some(tile=>{
    const from=Math.max(time-dt,tile.active),to=Math.min(time,tile.end);
    if(from>to || time<tile.active) return false;
    const a=at(from),b=at(to),distance=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(distance/2));
    for(let i=0;i<=steps;i++) if(tileDistance({x:a.x+(b.x-a.x)*i/steps,y:a.y+(b.y-a.y)*i/steps},tile)<=p.radius+distance/steps/2) return true;
    return false;
  });
}
