import { ARENA } from "../config";
import { lineDistance, type Point, type LaserPlayer } from "./laserHazards";
import { tileDistance, swarmTilesContact, type Tile } from "./swarmTiles";
export interface Collapse { tiles: Tile[]; safe: Point[]; destination: Point; variant: number; moveAt: number; finalAt: number }
const clamp=(n: number,a: number,b: number)=>Math.max(a,Math.min(b,n));
export function makeCollapse(players: LaserPlayer[],inset: number,variant: number): Collapse|undefined {
  const living=players.filter(p=>p.hp>0);if(!living.length) return undefined;
  const future=inset+5.2*1.5,width=(ARENA.right-ARENA.left)/10,height=(ARENA.bottom-ARENA.top)/6;
  const avg={x:living.reduce((s,p)=>s+p.x,0)/living.length,y:living.reduce((s,p)=>s+p.y,0)/living.length};
  const end={x:clamp(avg.x+100,ARENA.left+future+100,ARENA.right-future-100),y:clamp(avg.y,ARENA.top+future*.6+80,ARENA.bottom-future*.6-80)};
  // Snap the final island to a cell centre, leaving room for the full body.
  end.x=ARENA.left+(Math.floor((end.x-ARENA.left)/width)+.5)*width;
  end.y=ARENA.top+(Math.floor((end.y-ARENA.top)/height)+.5)*height;
  const start={x:end.x-150,y:end.y};
  if(start.x<ARENA.left+future+24||end.x>ARENA.right-future-24||end.y<ARENA.top+future*.6+24||end.y>ARENA.bottom-future*.6-24) return undefined;
  const layout: Collapse={tiles:[],safe:[],destination:end,variant,moveAt:2.8,finalAt:4.3};
  for(let cell=0;cell<60;cell++) {
    const col=cell%10,row=Math.floor(cell/10);
    const tile: Tile={x:ARENA.left+col*width,y:ARENA.top+row*height,width,height,born:0,active:0,end:5.2};
    const q={x:tile.x+width/2,y:tile.y+height/2};
    // Connected corridor remains until the final phase; final island is a
    // stepped diamond, not a shrinking rectangle.
    const island=Math.abs(q.x-end.x)/width+Math.abs(q.y-end.y)/height<=1;
    if(island) continue;
    const corridor=lineDistance(q,{x1:start.x,y1:start.y,x2:end.x,y2:end.y})<=Math.hypot(width,height)/2+40;
    const first=variant===0?(col+row)%2===0:variant===1?(col*7+row*11)%3===0:(col<5)!==(row<3);
    tile.active=corridor?4.3:first?1.3:2.8;tile.born=tile.active-1.3;
    layout.tiles.push(tile);
  }
  for(const p of living) {
    if(p.radius>16) return undefined;
    const q={x:clamp(p.x,start.x,end.x),y:end.y};
    if(Math.hypot(q.x-p.x,q.y-p.y)>265*(1.3-.4)) return undefined;
    if(layout.tiles.some(t=>t.active<4.3&&tileDistance(q,t)<=p.radius+10)) return undefined;
    // The complete transit segment must avoid all already collapsed cells.
    for(let i=0;i<=40;i++) {
      const point={x:q.x+(end.x-q.x)*i/40,y:q.y+(end.y-q.y)*i/40};
      if(layout.tiles.some(t=>t.active<4.3&&tileDistance(point,t)<=p.radius+10)) return undefined;
    }
    if(layout.tiles.some(t=>tileDistance(end,t)<=p.radius+10)) return undefined;
    if(Math.hypot(end.x-q.x,end.y-q.y)>265*(1.5-.4)) return undefined;
    layout.safe.push(q);
  }
  return layout;
}
export function collapseContact(layout: Collapse,p: LaserPlayer,time: number,dt=0,previous: Point=p): boolean {
  // Reuse swept rectangle collision; these cells remain destroyed until finish.
  return swarmTilesContact({kind:"tiles",warning:1.3,safe:[],refugeRadius:0,aggression:0,hunters:[],tiles:layout.tiles,pattern:"waves"},p,time,dt,previous);
}
