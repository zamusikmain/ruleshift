import { ARENA, C, center } from "../config";
import type { TextKey } from "../locales/en";
import {
  DIRECTIONS,
  edgeSegment,
  directionVector,
  type Direction,
} from "./direction";
import {
  MODIFIERS,
  COMBO_PRESSURE,
  EVENT_START,
  EVENT_INTERVAL,
  type Modifier,
  type MeteorPattern,
} from "./variants";
import { modeRules, overdrivePhase, type OfflineMode, type OnlineMode } from "./modes";
import { makeLaserLayout, laserContact, type LaserLayout } from "./laserHazards";
import { makeBurstLayout, burstContact, type BurstLayout } from "./burstHazards";
import { makeSwarmTiles, updateSwarm, swarmTilesContact, type SwarmTiles } from "./swarmTiles";
import { makeCrossfire, crossContact, type Crossfire } from "./crossfire";
import { makeCollapse, collapseContact, type Collapse } from "./collapse";
import { SAFE_PAIRS, SAFE_TRIPLES, certifyCombo, comboKey, extendedCombo, jointlySafe } from "./comboSafety";
import { survivalDifficulty } from "./offlineProgress";
import { OVERDRIVE_KINDS, makeOverdrive, overdriveContact, updateOverdrive, type Overdrive } from "./overdriveHazards";
export const RULE_DEFS = [
  { name: "keepMoving", description: "keepMovingDesc", color: C.lime },
  { name: "dangerZones", description: "dangerZonesDesc", color: C.danger },
  { name: "centerNow", description: "centerNowDesc", color: C.cyan },
  { name: "dodge", description: "dodgeDesc", color: C.danger },
  { name: "dontMove", description: "dontMoveDesc", color: C.cyan },
  { name: "laser", description: "laserDesc", color: C.danger },
  { name: "shrink", description: "shrinkDesc", color: C.danger },
  { name: "hunter", description: "hunterDesc", color: C.danger },
  { name: "meteor", description: "meteorDesc", color: C.danger },
  { name: "colorMatch", description: "colorMatchDesc", color: C.cyan },
  { name: "laserGrid", description: "laserGridDesc", color: C.danger },
  { name: "deathSpin", description: "deathSpinDesc", color: C.danger },
  { name: "meteorMadness", description: "meteorMadnessDesc", color: C.danger },
  { name: "hazardShockwave", description: "hazardShockwaveDesc", color: C.cyan },
  { name: "hunterSwarm", description: "hunterSwarmDesc", color: C.danger },
  { name: "dangerTiles", description: "dangerTilesDesc", color: C.danger },
  { name: "crossfire", description: "crossfireDesc", color: C.danger },
  { name: "finalCollapse", description: "finalCollapseDesc", color: C.danger },
  { name: "chainLightning", description: "chainLightningDesc", color: C.cyan },
  { name: "gravityPulse", description: "gravityPulseDesc", color: C.cyan },
  { name: "movingWalls", description: "movingWallsDesc", color: C.danger },
  { name: "minefield", description: "minefieldDesc", color: C.danger },
  { name: "orbitalStrike", description: "orbitalStrikeDesc", color: C.danger },
  { name: "blackHole", description: "blackHoleDesc", color: C.cyan },
  { name: "bulletStorm", description: "bulletStormDesc", color: C.danger },
  { name: "arenaSplit", description: "arenaSplitDesc", color: C.danger },
] as const satisfies readonly {
  name: TextKey;
  description: TextKey;
  color: number;
}[];
export const COMPATIBLE_PAIRS: readonly (readonly [number, number])[] = [
  [0, 8],
  [0, 7],
  [3, 6],
  [0, 5],
  [5, 8],
  [7, 8],
];
export const compatible = (a: number, b: number): boolean =>
  [...COMPATIBLE_PAIRS,...SAFE_PAIRS].some(
    (pair) => pair.includes(a) && pair.includes(b) && a !== b,
  );
export interface RulePlayer {
  id: string;
  x: number;
  y: number;
  radius: number;
  distance: number;
  hp: number;
  damageTaken?: number;
}
export interface Hazard {
  kind: "zone" | "shot" | "hunter" | "meteor";
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  born: number;
  target?: string;
  id?: number;
}
export interface RuleSnapshot {
  phase: "rest" | "announce" | "active";
  ids: number[];
  remaining: number;
  elapsed: number;
  duration: number;
  tier: number;
  hazards: Hazard[];
  symbol: number;
  serial: number;
  direction: Direction;
  secondDirection: Direction;
  modifiers: Partial<Record<number, Modifier>>;
  meteorPattern: MeteorPattern;
  event: boolean;
  pressure: number;
  laserLayout?: LaserLayout;
  burstLayout?: BurstLayout;
  swarmTiles?: SwarmTiles;
  crossfire?: Crossfire;
  collapse?: Collapse;
  overdrive?: Overdrive;
  overdriveLayers?: Overdrive[];
  intensity?: 0|1|2|3;
  intensityRemaining?: number;
  comboSafe?: {x:number;y:number}[];
}
interface Tracking {
  idle: number;
  movement: number;
  checked: Set<number>;
  failed: boolean;
  near: Set<string>;
  damage: number;
  laserPrevious?: { x: number; y: number };
}
export interface RandomSource {
  pick(values: number[]): number;
  between(min: number, max: number): number;
  shuffle(values: number[]): number[];
}
const defaultRandom: RandomSource = {
  pick: (values) => values[Math.floor(Math.random() * values.length)],
  between: (min, max) => min + Math.floor(Math.random() * (max - min + 1)),
  shuffle: (values) => {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  },
};
export class RuleEngine {
  state: RuleSnapshot = {
    phase: "rest",
    ids: [],
    remaining: 2.5,
    elapsed: 0,
    duration: 6,
    tier: 0,
    hazards: [],
    symbol: 0,
    serial: 0,
    direction: "TOP",
    secondDirection: "LEFT",
    modifiers: {},
    meteorPattern: "targeted",
    event: false,
    pressure: 1,
  };
  private tracking = new Map<string, Tracking>();
  private nextEvent = EVENT_START;
  private hazardSerial = 0;
  private meteorIndex = 0;
  private nextShot = 0.2;
  private nextMeteor = 0.2;
  private readonly rules;
  private recent: number[]=[];
  private recentCombos: string[]=[];
  constructor(
    private random: RandomSource = defaultRandom,
    private mode: OfflineMode | OnlineMode = "classic",
  ) {
    this.rules = modeRules(mode);
    this.state.remaining = this.rules.rest;
    this.state.duration = this.rules.duration;
  }
  update(
    dt: number,
    survival: number,
    players: RulePlayer[],
    hit: (id: string) => boolean | void,
    reward: (id: string, count: number) => void,
    fail: (id: string) => void = () => {},
    near: (id: string) => void = () => {},
    pressure = 1,
    arenaInset = 0,
  ): void {
    const s = this.state;
    const window=overdrivePhase(this.mode,survival);
    s.intensity=window.intensity;
    s.intensityRemaining=window.remaining;
    s.pressure = pressure*(this.mode==="survival"?survivalDifficulty(survival).pressure:1);
    s.remaining -= dt;
    s.tier = survival >= 60 ? 2 : survival >= 30 ? 1 : 0;
    if (s.phase === "rest") {
      if (s.remaining <= 0) {
        const previous = s.ids;
        const available=RULE_DEFS.map((_,i)=>i).filter(i=>(this.mode!=="daily"||i===10||i===11)&&!previous.includes(i)&&(i!==17||survival>=(this.mode==="blitz"?45:60)));
        const fresh=available.filter(i=>!this.recent.includes(i));
        const pool=fresh.length?fresh:available;
        const comboPool=pool.filter(id=>SAFE_PAIRS.some(pair=>pair.includes(id)));
        const first=this.random.pick((this.mode==="chaos"||s.intensity>0)&&comboPool.length&&this.random.between(0,99)<(s.intensity?Math.min(95,75+s.intensity*5):80)?comboPool:pool);
        this.recent=[...this.recent,first].slice(-4);
        s.ids = [first];
        s.laserLayout = undefined;
        s.burstLayout = undefined;
        s.swarmTiles = undefined;
        s.crossfire = undefined;
        s.collapse = undefined;
        s.overdrive = undefined; s.overdriveLayers=undefined;
        s.comboSafe = undefined;
        if (
          this.mode!=="daily" && (this.rules.chaos || survival >= 30 || s.intensity>0) &&
          this.random.between(0, 99) < Math.min(95,(this.rules.chaos?80:this.mode==="survival"?survivalDifficulty(survival).comboChance:Math.min(45,20+survival/6))+s.intensity*20)
        ) {
          const candidates=SAFE_PAIRS.filter(c=>c.includes(first)&&c.every(i=>!previous.includes(i))&&!this.recentCombos.includes(comboKey(c)));
          if(candidates.length) {const pair=candidates[this.random.pick(candidates.map((_,i)=>i))];s.ids=[first,...pair.filter(i=>i!==first)];}
          if(this.rules.chaos && survival>=60 && this.random.between(0,99)<30+s.intensity*10) {
            const triples=SAFE_TRIPLES.filter(c=>s.ids.every(i=>c.includes(i))&&c.every(i=>!previous.includes(i))&&!this.recentCombos.includes(comboKey(c)));
            if(triples.length) {const triple=triples[this.random.pick(triples.map((_,i)=>i))];s.ids=[first,...triple.filter(i=>i!==first)];}
          }
        }
        s.event = survival >= this.nextEvent;
        if (s.event) {
          if(!this.recentCombos.includes(comboKey([10,12]))) s.ids = [10, 12];
          else s.event=false;
          this.nextEvent = survival + EVENT_INTERVAL;
        }
        s.modifiers = {};
        if (
          survival >= 30 &&
          (s.ids.length === 1 || survival >= 150) &&
          !s.event &&
          this.random.between(0, 99) < 55
        ) {
          const candidates = s.ids.filter((id) => MODIFIERS[id]);
          if (candidates.length) {
            const id =
              candidates[this.random.between(0, candidates.length - 1)];
            const allowed = MODIFIERS[id].filter(
              (m) => m !== "double" || survival >= 90,
            );
            s.modifiers[id] =
              allowed[this.random.between(0, allowed.length - 1)];
          }
        }
        s.direction = DIRECTIONS[this.random.between(0, 3)];
        const other = DIRECTIONS.filter((d) => d !== s.direction);
        s.secondDirection = other[this.random.between(0, 2)];
        const patterns: MeteorPattern[] =
          survival < 30
            ? ["targeted", "scattered"]
            : ["targeted", "scattered", "waveRight", "waveLeft", "center"];
        s.meteorPattern = patterns[this.random.between(0, patterns.length - 1)];
        s.phase = "announce";
        s.remaining =
          s.ids.length > 1
            ? Math.max(0.7, this.rules.announce + 0.2)
            : this.rules.announce;
        s.serial++;
        s.symbol = this.random.between(0, 2);
      }
      return;
    }
    if (s.phase === "announce") {
      if (s.remaining <= 0) this.start(players, arenaInset);
      return;
    }
    s.elapsed += dt;
    const living = players.filter((p) => p.hp > 0);
    for(const layer of s.overdriveLayers??(s.overdrive?[s.overdrive]:[])) updateOverdrive(layer,living,s.elapsed);
    // Mine fuses may change, but the invariant refuge must remain outside the
    // full swept volume each tick. Fail closed without granting event rewards.
    if(s.comboSafe&&s.comboSafe.some(q=>!jointlySafe(s,q,Math.max(12,...living.map(p=>p.radius))))) {
      s.phase='rest';s.remaining=.12;s.ids=[];s.hazards=[];
      s.laserLayout=undefined;s.burstLayout=undefined;s.swarmTiles=undefined;s.crossfire=undefined;s.collapse=undefined;
      s.overdrive=undefined;s.overdriveLayers=undefined;s.comboSafe=undefined;s.event=false;
      return;
    }
    if(s.swarmTiles) updateSwarm(s.swarmTiles,living,new Map([...this.tracking].map(([id,t])=>[id,t.laserPrevious!])),s.elapsed,dt);
    this.updateHazards(dt, living);
    for (const player of living) {
      let track = this.tracking.get(player.id);
      if (!track) {
        track = {
          idle: 0,
          movement: 0,
          checked: new Set(),
          failed: false,
          near: new Set(),
          damage: player.damageTaken ?? 0,
        };
        this.tracking.set(player.id, track);
      }
      const violation = () => {
        if (hit(player.id) !== false) {
          track.failed = true;
          fail(player.id);
        }
      };
      if ((s.overdriveLayers??(s.overdrive?[s.overdrive]:[])).some(layer=>overdriveContact(layer,player,s.elapsed,dt,track.laserPrevious))) violation();
      if (s.laserLayout && s.elapsed < s.duration-0.25 && laserContact(s.laserLayout,player,s.elapsed,dt,track.laserPrevious)) violation();
      if (s.burstLayout && burstContact(s.burstLayout,player,s.elapsed,dt,track.laserPrevious)) violation();
      if (s.swarmTiles && swarmTilesContact(s.swarmTiles,player,s.elapsed,dt,track.laserPrevious)) violation();
      if (s.crossfire && crossContact(s.crossfire,player,s.elapsed,dt,track.laserPrevious)) violation();
      if (s.collapse && collapseContact(s.collapse,player,s.elapsed,dt,track.laserPrevious)) violation();
      track.laserPrevious = { x: player.x, y: player.y };
      for (const id of s.ids) {
        if (id === 0) {
          track.idle = player.distance / dt < 12 ? track.idle + dt : 0;
          if (track.idle >= 1.2) {
            violation();
            track.idle = 0;
          }
        }
        if (
          id === 1 &&
          s.elapsed >= (s.comboSafe?2:1.5) &&
          s.elapsed < s.duration - 0.3 &&
          s.hazards.some(
            (h) =>
              h.kind === "zone" &&
              distance(player, h) < h.radius + player.radius,
          )
        )
          violation();
        if (
          id === 2 &&
          s.elapsed >= 4 - s.tier * 0.25 &&
          !track.checked.has(id)
        ) {
          track.checked.add(id);
          if (distance(player, center) > 86 - player.radius) violation();
        }
        if (id === 3)
          for (const h of s.hazards)
            if (
              h.kind === "shot" &&
              distance(player, h) < h.radius + player.radius
            ) {
              violation();
              h.x = -100;
            }
        if (id === 4 && s.elapsed >= 1.8 && s.elapsed < 3.8) {
          track.movement += player.distance;
          if (track.movement > 10) {
            violation();
            track.movement = 0;
          }
        }
        if (id === 5) {
          const beam = laserFrame(s);
          if (beam.active && segmentDistance(player, beam) < player.radius + 5)
            violation();
        }
        if (id === 6) {
          const inset = shrinkInset(s);
          if (
            player.x - player.radius < ARENA.left + inset ||
            player.x + player.radius > ARENA.right - inset ||
            player.y - player.radius < ARENA.top + inset * 0.6 ||
            player.y + player.radius > ARENA.bottom - inset * 0.6
          )
            violation();
        }
        if (
          id === 7 &&
          s.elapsed >= 1.5 &&
          s.hazards.some(
            (h) =>
              h.kind === "hunter" &&
              distance(player, h) < h.radius + player.radius,
          )
        )
          violation();
        if (
          id === 8 &&
          s.hazards.some(
            (h) =>
              h.kind === "meteor" &&
              s.elapsed - h.born >= meteorWarning(s) &&
              distance(player, h) < h.radius + player.radius,
          )
        )
          violation();
        if (id === 9 && s.elapsed >= 3.7 && !track.checked.has(id)) {
          track.checked.add(id);
          if (distance(player, symbolPosition(s.symbol)) > 80 - player.radius)
            violation();
        }
      }
      if ((player.damageTaken ?? 0) > track.damage) track.failed = true;
      const close = (key: string, gap: number) => {
        if (gap < 0 || gap > 18 || track.near.has(key) || player.hp <= 0 || (this.mode !== "daily" && player.distance / dt < 12))
          return;
        track.near.add(key);
        near(player.id);
      };
      for (const h of s.hazards) {
        const gap = distance(player, h) - h.radius - player.radius;
        const key = String(h.id ?? `${h.kind}:${h.born}`);
        if (
          gap < 0 &&
          (h.kind !== "meteor" || s.elapsed - h.born >= meteorWarning(s))
        )
          track.near.add(key);
        if (
          h.kind === "meteor" &&
          s.elapsed - h.born >= meteorWarning(s) + 0.25
        )
          close(key, gap);
        if (
          h.kind === "shot" &&
          (player.x - h.x) * h.vx + (player.y - h.y) * h.vy < 0
        )
          close(key, gap);
      }
      if (s.ids.includes(5)) {
        const beam = laserFrame(s),
          gap = segmentDistance(player, beam) - player.radius - 5;
        if (beam.active) {
          if (gap < 0) track.near.add(`laser:${beam.index}`);
          else {
            const v = directionVector(beam.direction);
            if ((player.x - beam.x1) * v.x + (player.y - beam.y1) * v.y < 0)
              close(`laser:${beam.index}`, gap);
          }
        }
      }
    }
    if (s.remaining <= 0) {
      for (const p of living)
        if (p.hp > 0 && !this.tracking.get(p.id)?.failed)
          reward(p.id, s.ids.length);
      s.phase = "rest";
      const acceleration=this.mode==="survival"?1+survival/45:this.mode==="classic"?1+survival/120:1+survival/240;
      s.remaining = this.mode==="survival"?survivalDifficulty(survival).rest/pressure:Math.max(.18,this.rules.rest / pressure / acceleration);
      s.remaining=Math.max(.12,s.remaining/(1+(s.intensity??0)*.5));
      s.hazards = [];
      s.laserLayout = undefined;
      s.burstLayout = undefined;
      s.swarmTiles = undefined;
      s.crossfire = undefined;
      s.collapse = undefined;
        s.overdrive = undefined; s.overdriveLayers=undefined;
      s.comboSafe = undefined;
    }
  }
  private start(players: RulePlayer[], arenaInset = 0): void {
    const s = this.state;
    s.laserLayout=undefined;s.burstLayout=undefined;s.swarmTiles=undefined;
    s.crossfire=undefined;s.collapse=undefined;s.overdrive=undefined;s.overdriveLayers=undefined;s.comboSafe=undefined;
    s.phase = "active";
    const baseDuration =
      s.event || s.modifiers[5] === "double"
        ? 10
        : s.ids.includes(5)
          ? s.ids.length > 1
            ? 7
            : 6
          : 6 - s.tier;
    s.duration =
      this.rules.duration < 6 ? Math.min(this.rules.duration, baseDuration) : baseDuration;
    // Timed objectives must reach their check, including in short Blitz rounds.
    if (s.ids.includes(2)) s.duration = Math.max(s.duration, 4 - s.tier * 0.25 + 0.25);
    if (s.ids.includes(4)) s.duration = Math.max(s.duration, 4.05);
    if (s.ids.includes(9)) s.duration = Math.max(s.duration, 3.95);
    if(s.ids.includes(16)) s.duration=6.5;
    if(s.ids.includes(17)) s.duration=5.2;
    if(s.ids.includes(15)) s.duration=4.5;
    if(s.ids.some(id=>id>=18)) s.duration=6.8;
    const extended=extendedCombo(s.ids);
    if(extended) s.duration=s.ids.length===3?8.4:7.8;
    s.remaining = s.duration;
    s.elapsed = 0;
    s.hazards = [];
    if(s.ids.some(id=>id>=18)) {
      const rotation=this.random.between(0,5),layers:Overdrive[]=[];
      for(const id of s.ids.filter(id=>id>=18)) {
        const layer=makeOverdrive(OVERDRIVE_KINDS[id-18],players,s.tier,this.mode,arenaInset,rotation);
        if(!layer) {this.fallback(players,arenaInset);return;}
        layers.push(layer);
      }
      s.overdrive=layers.length===1?layers[0]:undefined;
      if(layers.length>1) s.overdriveLayers=layers;
    }
    if(s.ids.includes(17)) {
      s.collapse=makeCollapse(players,arenaInset,this.random.between(0,2));
      if(!s.collapse) {s.phase="rest";s.remaining=.4;s.ids=[];return;}
    }
    if(s.ids.includes(16)) {
      s.crossfire=makeCrossfire(players,s.tier,this.mode,arenaInset,this.random.between(0,3));
      if(!s.crossfire) {s.phase="rest";s.remaining=.4;s.ids=[];return;}
    }
    if (s.ids.includes(14) || s.ids.includes(15)) {
      s.swarmTiles = makeSwarmTiles(s.ids.includes(14)?"swarm":"tiles",players,s.tier,this.mode,s.duration,arenaInset,this.random);
      if (!s.swarmTiles) { s.phase="rest";s.remaining=.4;s.ids=[];return; }
    }
    if (s.ids.includes(12) || s.ids.includes(13)) {
      s.burstLayout = makeBurstLayout(s.ids.includes(12)?"madness":"shockwave",players,s.tier,this.mode,s.duration-(s.ids.length>1?(extended?1.45:.65):0),arenaInset,this.random);
      if (!s.burstLayout) {
        if(s.ids.length>1) {s.ids=s.ids.filter(id=>id!==12&&id!==13);s.serial++;this.start(players,arenaInset);return;}
        s.phase="rest";
        s.remaining=0.4;
        s.ids=[];
        return;
      }
    }
    if (s.ids.includes(10) || s.ids.includes(11)) {
      s.laserLayout = makeLaserLayout(s.ids.includes(10)?"grid":"spin",players,s.tier,this.mode,
        // Reserve room for continued Sudden Death contraction during the event.
        arenaInset+s.duration*1.5,
        this.random.between(0,359)*Math.PI/180);
      if (!s.laserLayout) {
        if(s.ids.length>1) {s.ids=s.ids.filter(id=>id!==10&&id!==11);s.serial++;this.start(players,arenaInset);return;}
        s.phase="rest";
        s.remaining=0.4;
        s.ids=[];
        return;
      }
    }
    this.tracking.clear();
    for (const p of players.filter((p) => p.hp > 0))
      this.tracking.set(p.id, {
        idle: 0,
        movement: 0,
        checked: new Set(),
        failed: false,
        near: new Set(),
        damage: p.damageTaken ?? 0,
        laserPrevious: { x: p.x, y: p.y },
      });
    this.meteorIndex = 0;
    this.nextShot = 0.2;
    this.nextMeteor = 0.2;
    if (s.ids.includes(1)) {
      const cells = this.random.shuffle(
        Array.from({ length: 12 }, (_, i) => i),
      );
      for (const cell of cells.slice(0, 4 + s.tier))
        s.hazards.push({
          id: ++this.hazardSerial,
          kind: "zone",
          x: 180 + (cell % 4) * 260 + this.random.between(-25, 25),
          y: 235 + Math.floor(cell / 4) * 160,
          radius: 66 + s.tier * 6,
          vx: 0,
          vy: 0,
          born: 0,
        });
    }
    if (s.ids.includes(7) && players.length) {
      const target = players[this.random.between(0, players.length - 1)];
      const candidates = [
        { x: ARENA.left + 35, y: ARENA.top + 35 },
        { x: ARENA.right - 35, y: ARENA.top + 35 },
        { x: ARENA.left + 35, y: ARENA.bottom - 35 },
        { x: ARENA.right - 35, y: ARENA.bottom - 35 },
      ]
        .filter((corner) => distance(target, corner) >= 300)
        .map((corner) => {
          const length = distance(target, corner);
          return {
            x: target.x + ((corner.x - target.x) / length) * 300,
            y: target.y + ((corner.y - target.y) / length) * 300,
          };
        })
        .filter((point) => players.every((p) => distance(point, p) >= 210));
      if (!candidates.length) return;
      const spawn = candidates[this.random.between(0, candidates.length - 1)];
      s.hazards.push({
        id: ++this.hazardSerial,
        kind: "hunter",
        ...spawn,
        radius: 17,
        vx: 0,
        vy: 0,
        born: 0,
        target: target.id,
      });
    }
    if(s.ids.length>1) {
      const warning=extended?2.8:2;
      if(s.laserLayout) s.laserLayout.warning=warning;
      if(s.swarmTiles) s.swarmTiles.warning=warning;
      for(const [index,layer] of (s.overdriveLayers??(s.overdrive?[s.overdrive]:[])).entries()) {
        const shift=.4+(s.intensity?index*.35:0);
        layer.warning+=shift;layer.duration+=shift;
        for(const h of layer.threats){h.warning+=shift;h.active+=shift;h.end+=shift;if(h.armed!==undefined)h.armed+=shift;}
      }
      if(s.burstLayout) {
        s.burstLayout.warning=warning;
        const shift=extended?1.45:.65;
        for(const e of s.burstLayout.explosions) {e.born+=shift;e.impact+=shift;}
        for(const w of s.burstLayout.waves) {w.born+=shift;w.impact+=shift;}
      }
      s.comboSafe=certifyCombo(s,players,arenaInset);
      if(!s.comboSafe) {
        this.fallback(players,arenaInset);return;
      }
      if(s.laserLayout) s.laserLayout.safe=s.comboSafe;
      if(s.burstLayout) s.burstLayout.safe=s.comboSafe;
      for(const layer of s.overdriveLayers??(s.overdrive?[s.overdrive]:[])) layer.safe=s.comboSafe;
      this.recentCombos=[...this.recentCombos,comboKey(s.ids)].slice(-3);
    }
  }
  private fallback(players:RulePlayer[],inset:number):void {
    if(this.state.ids.length>1) {
      this.state.ids=[this.state.ids[0]];this.state.event=false;this.state.serial++;
      this.start(players,inset);
    } else {this.state.phase='rest';this.state.remaining=.4;this.state.ids=[];}
  }
  private updateHazards(dt: number, players: RulePlayer[]): void {
    const s = this.state;
    if (!players.length) return;
    this.nextShot -= dt;
    this.nextMeteor -= dt;
    if (s.ids.includes(3) && this.nextShot <= 0 && s.remaining > 1.2) {
      this.nextShot =
        (0.85 - s.tier * 0.15) /
        hazardPressure(s) /
        (s.modifiers[3] === "dense" ? 1.3 : 1);
      const target = players[this.random.between(0, players.length - 1)],
        side = this.random.between(0, 3);
      let x =
        side < 2
          ? side === 0
            ? ARENA.left
            : ARENA.right
          : this.random.between(ARENA.left, ARENA.right);
      let y =
        side >= 2
          ? side === 2
            ? ARENA.top
            : ARENA.bottom
          : this.random.between(ARENA.top, ARENA.bottom);
      // All players get reaction distance, including those not targeted by this projectile.
      if (players.some((p) => distance(p, { x, y }) < 260)) {
        const corners = [
          { x: ARENA.left, y: ARENA.top },
          { x: ARENA.right, y: ARENA.top },
          { x: ARENA.left, y: ARENA.bottom },
          { x: ARENA.right, y: ARENA.bottom },
        ];
        corners.sort(
          (a, b) =>
            Math.min(...players.map((p) => distance(p, b))) -
            Math.min(...players.map((p) => distance(p, a))),
        );
        ({ x, y } = corners[0]);
      }
      if (players.every((p) => distance(p, { x, y }) >= 180)) {
        const length = distance(target, { x, y }) || 1,
          speed =
            (210 + s.tier * 35) *
            (s.modifiers[3] === "fast" ? 1.2 : 1) *
            Math.min(1.15, hazardPressure(s));
        s.hazards.push({
          id: ++this.hazardSerial,
          kind: "shot",
          x,
          y,
          vx: ((target.x - x) / length) * speed,
          vy: ((target.y - y) / length) * speed,
          radius: 7,
          born: s.elapsed,
        });
      }
    }
    if (s.ids.includes(8) && this.nextMeteor <= 0 && s.remaining > 1.6) {
      this.nextMeteor =
        (0.85 - s.tier * 0.1) /
        hazardPressure(s) /
        (s.modifiers[8] === "dense" ? 1.3 : 1);
      const target = players[this.random.between(0, players.length - 1)];
      const index = this.meteorIndex++;
      let x = target.x,
        y = target.y;
      if (s.meteorPattern === "scattered") {
        x = this.random.between(ARENA.left + 70, ARENA.right - 70);
        y = this.random.between(ARENA.top + 70, ARENA.bottom - 70);
      }
      if (s.meteorPattern === "waveRight" || s.meteorPattern === "waveLeft") {
        const progress = (index % 5) / 4;
        x =
          ARENA.left +
          100 +
          (s.meteorPattern === "waveRight" ? progress : 1 - progress) *
            (ARENA.right - ARENA.left - 200);
        y = center.y + (index % 2 ? 90 : -90);
      }
      if (s.meteorPattern === "center") {
        x = center.x + Math.cos(index * 2.4) * 125;
        y = center.y + Math.sin(index * 2.4) * 95;
      }
      s.hazards.push({
        id: ++this.hazardSerial,
        kind: "meteor",
        x,
        y,
        radius: s.modifiers[8] === "giant" ? 72 : 52,
        vx: 0,
        vy: 0,
        born: s.elapsed,
      });
    }
    s.hazards = s.hazards.filter(
      (h) =>
        h.x >= ARENA.left - 20 &&
        h.x <= ARENA.right + 20 &&
        h.y >= ARENA.top - 20 &&
        h.y <= ARENA.bottom + 20 &&
        (h.kind !== "meteor" || s.elapsed - h.born < meteorWarning(s) + 0.35),
    );
    for (const h of s.hazards) {
      if (h.kind === "hunter" && s.elapsed >= 1.5) {
        const target = players.find((p) => p.id === h.target) ?? players[0];
        h.target = target.id;
        const length = distance(target, h) || 1,
          speed = (130 + s.tier * 15) * Math.min(1.1, hazardPressure(s));
        h.vx = ((target.x - h.x) / length) * speed;
        h.vy = ((target.y - h.y) / length) * speed;
      }
      h.x += h.vx * dt;
      h.y += h.vy * dt;
    }
  }
}
export const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(a.x - b.x, a.y - b.y);
export const laserY = (s: RuleSnapshot): number =>
  ARENA.top +
  35 +
  Math.max(0, (s.elapsed - 1.5) / (s.duration - 1.8)) *
    (ARENA.bottom - ARENA.top - 70);
export const shrinkInset = (s: RuleSnapshot): number =>
  Math.min(110, Math.max(0, s.elapsed - 1.5) * 42);
export const symbolPosition = (symbol: number): { x: number; y: number } => ({
  x: center.x + (symbol - 1) * 240,
  y: center.y,
});
export function isFrozen(s: RuleSnapshot): boolean {
  return (
    s.phase === "active" &&
    s.ids.includes(4) &&
    s.elapsed >= 1.8 &&
    s.elapsed < 3.8
  );
}
export function hazardPressure(s: RuleSnapshot): number {
  return (s.ids.length > 1 ? COMBO_PRESSURE : 1) * (s.pressure ?? 1);
}
export function meteorWarning(s: RuleSnapshot): number {
  return (
    (s.modifiers?.[8] === "fast" ? 1.05 : 1.25) + (s.ids.length > 1 ? 0.3 : 0)
  );
}
export function laserFrame(s: RuleSnapshot) {
  const double = s.modifiers?.[5] === "double";
  const slot = double ? s.duration / 2 : s.duration;
  const elapsed = s.phase === "announce" ? 0 : s.elapsed;
  const index = double && elapsed >= slot ? 1 : 0;
  const local = elapsed - index * slot;
  const warning = s.ids.length > 1 ? 1.8 : 1.5;
  const travel =
    Math.max(1, slot - warning - 0.3) /
    (s.modifiers?.[5] === "fast" ? 1.25 : 1);
  const direction = index
    ? (s.secondDirection ?? "LEFT")
    : (s.direction ?? "TOP");
  return {
    ...edgeSegment(direction, (local - warning) / travel),
    direction,
    index,
    active:
      s.phase === "active" && local >= warning && local < warning + travel,
    warning: local < warning,
  };
}
export function segmentDistance(
  p: { x: number; y: number },
  line: { x1: number; y1: number; x2: number; y2: number },
): number {
  const dx = line.x2 - line.x1,
    dy = line.y2 - line.y1;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - line.x1) * dx + (p.y - line.y1) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - line.x1 - t * dx, p.y - line.y1 - t * dy);
}
