import { ARENA } from "../config";
import { lineDistance, type Point } from "./laserHazards";
import { angleDifference } from "./burstHazards";
import { overdriveSafe, OVERDRIVE_KINDS } from "./overdriveHazards";
import { createBody, moveBody, normalizeInput } from "./movement";
import type { RulePlayer, RuleSnapshot } from "./ruleEngine";
export const NEW_PAIRS: readonly (readonly number[])[]=[[20,24],[23,22],[25,21],[19,10]];
export const NEW_TRIPLES: readonly (readonly number[])[]=[[20,24,22]];
export const REJECTED_COMBOS: readonly (readonly number[])[]=[[15,18],[11,16],[15,18,13],[23,21,16],[10,12,14]];
export const SAFE_PAIRS: readonly (readonly number[])[]=[[1,10],[1,11],[10,12],[10,13],[11,12],[11,13],...NEW_PAIRS];
export const SAFE_TRIPLES: readonly (readonly number[])[]=[[1,10,12],[1,11,13],...NEW_TRIPLES];
export const comboKey=(ids:readonly number[])=>[...ids].sort((a,b)=>a-b).join('+');
export const extendedCombo=(ids:number[])=>[...NEW_PAIRS,...NEW_TRIPLES].some(c=>comboKey(c)===comboKey(ids));
export function comboWarning(s:RuleSnapshot):number {
  return Math.min(s.laserLayout?.warning??Infinity,s.burstLayout?.warning??Infinity,s.swarmTiles?.warning??Infinity,...(s.overdriveLayers??(s.overdrive?[s.overdrive]:[])).map(l=>l.warning),2.8);
}
export function supportedCombo(ids: number[]): boolean {
  return [...SAFE_PAIRS,...SAFE_TRIPLES].some(c=>c.length===ids.length&&c.every(id=>ids.includes(id)));
}
// Analytic invariant: every point in the certificate remains clear for the
// complete schedule, including rotating beams, wave gaps and secondary blasts.
// A straight unobstructed transit finishes before the earliest activation.
export function jointlySafe(s: RuleSnapshot,p: Point,radius: number): boolean {
  const margin=radius+10;
  if((s.overdriveLayers??(s.overdrive?[s.overdrive]:[])).some(l=>!overdriveSafe(l,p,radius))) return false;
  if(s.crossfire||s.collapse) return false; // Changing refuges need a separate temporal proof.
  if(s.swarmTiles) {
    if(s.swarmTiles.kind!=="swarm") return false;
    if(!s.swarmTiles.safe.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<s.swarmTiles!.refugeRadius-margin)) return false;
  }
  if(s.hazards.some(h=>h.kind!=="zone" || Math.hypot(p.x-h.x,p.y-h.y)<=h.radius+margin)) return false;
  const laser=s.laserLayout;
  if(laser) {
    if(laser.kind==="grid" && laser.lines.some(l=>lineDistance(p,l)<=margin+laser.width/2)) return false;
    const d=Math.hypot(p.x-laser.pivot.x,p.y-laser.pivot.y);
    if(laser.kind==="spin" && d>=laser.inner-margin-laser.width/2 && d<=laser.outer+margin+laser.width/2) return false;
  }
  const burst=s.burstLayout;
  if(burst) {
    if(burst.explosions.some(e=>Math.hypot(p.x-e.x,p.y-e.y)<=e.radius+margin)) return false;
    for(const w of burst.waves) {
      const r=Math.hypot(p.x-w.x,p.y-w.y),m=margin+w.width/2;
      if(r<w.inner-m || r>w.outer+m) continue;
      const gap=w.halfGap-Math.abs(angleDifference(Math.atan2(p.y-w.y,p.x-w.x),w.gap));
      if(gap<=0 || r*Math.sin(Math.min(Math.PI/2,gap))<=m) return false;
    }
  }
  return true;
}
export function certifyCombo(s: RuleSnapshot,players: RulePlayer[],inset: number): Point[]|undefined {
  if(!supportedCombo(s.ids)) return undefined;
  const layers=s.overdriveLayers??(s.overdrive?[s.overdrive]:[]);
  if(s.ids.some(id=>id>=18&&!layers.some(l=>l.kind===OVERDRIVE_KINDS[id-18]))) return undefined;
  if(s.ids.includes(10)&&s.laserLayout?.kind!=='grid'||s.ids.includes(11)&&s.laserLayout?.kind!=='spin') return undefined;
  const alive=players.filter(p=>p.hp>0);if(!alive.length) return undefined;
  const warning=comboWarning(s);
  // .3s reaction, up to .16s of an already active Dash plus boosted drift,
  // then reversal/acceleration. A ready Dash is never required for escape.
  const reach=265*Math.max(0,warning-1.2),future=inset+s.duration*1.5;
  const result: Point[]=[];
  for(const p of alive) {
    let best=Infinity,destination: Point|undefined;
    for(let x=ARENA.left+future+p.radius+10;x<=ARENA.right-future-p.radius-10;x+=12)
      for(let y=ARENA.top+future*.6+p.radius+10;y<=ARENA.bottom-future*.6-p.radius-10;y+=12) {
        const d=Math.hypot(x-p.x,y-p.y);
        if(d>reach||d>=best||!jointlySafe(s,{x,y},p.radius)) continue;
        destination={x,y};best=d;
      }
    if(!destination) return undefined;
    if(extendedCombo(s.ids)) {
      // Validate the actual authoritative initial motion as well as the
      // conservative distance budget. An outward Dash at the contracting edge
      // must not be mistaken for a reachable safe route.
      const body=Object.assign(createBody(p.x,p.y),p);
      const reaction=normalizeInput(body.vx,body.vy),step=1/120;
      for(let time=step;time<=warning+1e-6;time+=step) {
        const dx=destination.x-body.x,dy=destination.y-body.y,d=Math.hypot(dx,dy);
        moveBody(body,time<=.3?reaction:{x:dx/Math.max(30,d),y:dy/Math.max(30,d)},step);
        const contraction=inset+time*1.5;
        if(body.x-body.radius<ARENA.left+contraction||body.x+body.radius>ARENA.right-contraction||body.y-body.radius<ARENA.top+contraction*.6||body.y+body.radius>ARENA.bottom-contraction*.6) return undefined;
      }
      if(Math.hypot(body.x-destination.x,body.y-destination.y)>3||Math.hypot(body.vx,body.vy)>20||!jointlySafe(s,body,body.radius)) return undefined;
    }
    result.push(destination);
  }
  return result;
}
