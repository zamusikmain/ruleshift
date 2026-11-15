import { ARENA, center } from "../config";
import type { OfflineMode, OnlineMode } from "./modes";

export interface Point { x: number; y: number }
export interface Segment { x1: number; y1: number; x2: number; y2: number }
export interface LaserPlayer extends Point { radius: number; hp: number }
export interface LaserLayout {
  kind: "grid" | "spin";
  warning: number;
  width: number;
  lines: Segment[];
  pivot: Point;
  angle: number;
  speed: number;
  inner: number;
  outer: number;
  safe: Point[];
}
export const LASER_MOVE_SPEED = 265;
// Reserve reaction time and acceleration; safety never relies on Dash or boosts.
export const REACTION_SECONDS = 0.3;
export function lineDistance(p: Point, l: Segment): number {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const u = Math.max(0, Math.min(1, ((p.x-l.x1)*dx+(p.y-l.y1)*dy)/(dx*dx+dy*dy || 1)));
  return Math.hypot(p.x-l.x1-u*dx, p.y-l.y1-u*dy);
}
export function laserLines(layout: LaserLayout, elapsed: number): Segment[] {
  if (layout.kind === "grid") return layout.lines;
  const a = layout.angle + Math.max(0, elapsed-layout.warning)*layout.speed;
  return [a, a+Math.PI].map(angle => ({
    x1: layout.pivot.x+Math.cos(angle)*layout.inner,
    y1: layout.pivot.y+Math.sin(angle)*layout.inner,
    x2: layout.pivot.x+Math.cos(angle)*layout.outer,
    y2: layout.pivot.y+Math.sin(angle)*layout.outer,
  }));
}
export function laserContact(layout: LaserLayout, p: LaserPlayer, elapsed: number, dt = 0, previous: Point = p): boolean {
  if (elapsed < layout.warning) return false;
  // Sample the swept angle, inflating by the maximum arc distance between samples.
  // This catches a rotating beam crossing a stationary body between server ticks.
  const start = Math.max(layout.warning, elapsed-dt);
  const angularTravel = layout.kind === "spin" ? layout.outer*Math.abs(layout.speed)*(elapsed-start) : 0;
  const bodyTravel = Math.hypot(p.x-previous.x,p.y-previous.y);
  const steps = Math.max(1, Math.ceil((angularTravel+bodyTravel)/2));
  const margin = (angularTravel+bodyTravel)/steps/2;
  for (let i=0;i<=steps;i++) {
    const time=start+(elapsed-start)*i/steps;
    const fraction=dt>0 ? Math.max(0,Math.min(1,(time-(elapsed-dt))/dt)) : 1;
    const position={x:previous.x+(p.x-previous.x)*fraction,y:previous.y+(p.y-previous.y)*fraction};
    if (laserLines(layout,time).some(l => lineDistance(position,l) <= p.radius+layout.width/2+margin)) return true;
  }
  return false;
}
export function reachableSafe(layout: LaserLayout, p: LaserPlayer, inset=0): Point | undefined {
  const margin = p.radius+layout.width/2+8;
  const left=ARENA.left+inset+p.radius+8, right=ARENA.right-inset-p.radius-8;
  const top=ARENA.top+inset*0.6+p.radius+8, bottom=ARENA.bottom-inset*0.6-p.radius-8;
  if (left>=right || top>=bottom) return undefined;
  let nearest: Point | undefined;
  let distance = Infinity;
  for (let x=left;x<=right;x+=16) for (let y=top;y<=bottom;y+=16) {
    const q={x,y};
    const safe=layout.kind === "grid"
      ? layout.lines.every(l=>lineDistance(q,l)>margin)
      : Math.hypot(x-layout.pivot.x,y-layout.pivot.y)<layout.inner-margin || Math.hypot(x-layout.pivot.x,y-layout.pivot.y)>layout.outer+margin;
    const d=Math.hypot(x-p.x,y-p.y);
    if (safe && d<distance) { nearest=q; distance=d; }
  }
  return nearest && distance<=LASER_MOVE_SPEED*Math.max(0,layout.warning-REACTION_SECONDS-0.1) ? nearest : undefined;
}
export function makeLaserLayout(kind: LaserLayout["kind"], players: LaserPlayer[], tier: number,
  mode: OfflineMode | OnlineMode, inset=0, angle=0): LaserLayout | undefined {
  const layout: LaserLayout={kind, warning: kind==="grid"?1.2:1.1, width:6+Math.min(2,tier)*2,
    lines:[], pivot:{...center}, angle, speed:Math.min(0.95,(mode==="blitz"||mode==="chaos"?0.65:0.4)+tier*0.12),
    inner:70, outer:150+Math.min(2,tier)*25, safe:[]};
  if (kind==="grid") {
    const count=3+Math.min(2,tier);
    for(let i=1;i<=count;i++) {
      const x=ARENA.left+(ARENA.right-ARENA.left)*i/(count+1);
      layout.lines.push({x1:x,y1:ARENA.top,x2:x,y2:ARENA.bottom});
    }
    for(let i=1;i<=2+Math.min(1,tier);i++) {
      const y=ARENA.top+(ARENA.bottom-ARENA.top)*i/(3+Math.min(1,tier));
      layout.lines.push({x1:ARENA.left,y1:y,x2:ARENA.right,y2:y});
    }
  }
  const living=players.filter(p=>p.hp>0);
  if (!living.length) return undefined;
  for(const p of living) {
    const q=reachableSafe(layout,p,inset);
    if(!q) return undefined;
    layout.safe.push(q);
  }
  return layout;
}
