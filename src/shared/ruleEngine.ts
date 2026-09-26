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
  COMPATIBLE_PAIRS.some(
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
}
interface Tracking {
  idle: number;
  movement: number;
  checked: Set<number>;
  failed: boolean;
  near: Set<string>;
  damage: number;
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
  constructor(private random: RandomSource = defaultRandom) {}
  update(
    dt: number,
    survival: number,
    players: RulePlayer[],
    hit: (id: string) => boolean | void,
    reward: (id: string, count: number) => void,
    fail: (id: string) => void = () => {},
    near: (id: string) => void = () => {},
    pressure = 1,
  ): void {
    const s = this.state;
    s.pressure = pressure;
    s.remaining -= dt;
    s.tier = survival >= 60 ? 2 : survival >= 30 ? 1 : 0;
    if (s.phase === "rest") {
      if (s.remaining <= 0) {
        const previous = s.ids;
        const first = this.random.pick(
          RULE_DEFS.map((_, i) => i).filter((i) => !previous.includes(i)),
        );
        s.ids = [first];
        if (
          survival >= 90 &&
          this.random.between(0, 99) < Math.min(45, 25 + (survival - 60) / 6)
        ) {
          const partner = RULE_DEFS.map((_, i) => i).filter(
            (i) => compatible(first, i) && !previous.includes(i),
          );
          if (partner.length) s.ids.push(this.random.pick(partner));
        }
        s.event = survival >= this.nextEvent;
        if (s.event) {
          s.ids = [5, 8];
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
        s.remaining = s.ids.length > 1 ? 2 : 1.5;
        s.serial++;
        s.symbol = this.random.between(0, 2);
      }
      return;
    }
    if (s.phase === "announce") {
      if (s.remaining <= 0) this.start(players);
      return;
    }
    s.elapsed += dt;
    const living = players.filter((p) => p.hp > 0);
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
          s.elapsed >= 1.5 &&
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
        if (gap < 0 || gap > 18 || track.near.has(key) || player.hp <= 0)
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
      s.remaining = 2.5 / pressure;
      s.hazards = [];
    }
  }
  private start(players: RulePlayer[]): void {
    const s = this.state;
    s.phase = "active";
    s.duration =
      s.event || s.modifiers[5] === "double"
        ? 10
        : s.ids.includes(5)
          ? s.ids.length > 1
            ? 7
            : 6
          : 6 - s.tier;
    s.remaining = s.duration;
    s.elapsed = 0;
    s.hazards = [];
    this.tracking.clear();
    for (const p of players.filter((p) => p.hp > 0))
      this.tracking.set(p.id, {
        idle: 0,
        movement: 0,
        checked: new Set(),
        failed: false,
        near: new Set(),
        damage: p.damageTaken ?? 0,
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
