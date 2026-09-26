import { ARENA, C, center } from "../config";
import type { TextKey } from "../locales/en";
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
}
interface Tracking {
  idle: number;
  movement: number;
  checked: Set<number>;
  failed: boolean;
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
  };
  private tracking = new Map<string, Tracking>();
  private nextShot = 0.2;
  private nextMeteor = 0.2;
  constructor(private random: RandomSource = defaultRandom) {}
  update(
    dt: number,
    survival: number,
    players: RulePlayer[],
    hit: (id: string) => void,
    reward: (id: string, count: number) => void,
    fail: (id: string) => void = () => {},
  ): void {
    const s = this.state;
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
          survival >= 60 &&
          this.random.between(0, 99) < Math.min(45, 25 + (survival - 60) / 6)
        ) {
          const partner = RULE_DEFS.map((_, i) => i).filter(
            (i) => compatible(first, i) && !previous.includes(i),
          );
          if (partner.length) s.ids.push(this.random.pick(partner));
        }
        s.phase = "announce";
        s.remaining = 1.5;
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
        track = { idle: 0, movement: 0, checked: new Set(), failed: false };
        this.tracking.set(player.id, track);
      }
      const violation = () => {
        track.failed = true;
        fail(player.id);
        hit(player.id);
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
        if (
          id === 5 &&
          s.elapsed >= 1.5 &&
          s.elapsed < s.duration - 0.3 &&
          player.x > ARENA.left + 105 &&
          player.x < ARENA.right - 105 &&
          Math.abs(player.y - laserY(s)) < player.radius + 5
        )
          violation();
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
              s.elapsed - h.born >= 1.25 &&
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
    }
    if (s.remaining <= 0) {
      for (const p of living)
        if (p.hp > 0 && !this.tracking.get(p.id)?.failed)
          reward(p.id, s.ids.length);
      s.phase = "rest";
      s.remaining = 2.5;
      s.hazards = [];
    }
  }
  private start(players: RulePlayer[]): void {
    const s = this.state;
    s.phase = "active";
    s.duration = 6 - s.tier;
    s.remaining = s.duration;
    s.elapsed = 0;
    s.hazards = [];
    this.tracking.clear();
    this.nextShot = 0.2;
    this.nextMeteor = 0.2;
    if (s.ids.includes(1)) {
      const cells = this.random.shuffle(
        Array.from({ length: 12 }, (_, i) => i),
      );
      for (const cell of cells.slice(0, 4 + s.tier))
        s.hazards.push({
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
      const corner = {
        x: target.x < center.x ? ARENA.right - 35 : ARENA.left + 35,
        y: target.y < center.y ? ARENA.bottom - 35 : ARENA.top + 35,
      };
      const length = distance(target, corner);
      const spawn = {
        x: target.x + ((corner.x - target.x) / length) * 300,
        y: target.y + ((corner.y - target.y) / length) * 300,
      };
      s.hazards.push({
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
      this.nextShot = 0.85 - s.tier * 0.15;
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
          speed = 210 + s.tier * 35;
        s.hazards.push({
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
      this.nextMeteor = 0.85 - s.tier * 0.1;
      const target = players[this.random.between(0, players.length - 1)];
      s.hazards.push({
        kind: "meteor",
        x: target.x,
        y: target.y,
        radius: 52,
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
        (h.kind !== "meteor" || s.elapsed - h.born < 1.6),
    );
    for (const h of s.hazards) {
      if (h.kind === "hunter" && s.elapsed >= 1.5) {
        const target = players.find((p) => p.id === h.target) ?? players[0];
        h.target = target.id;
        const length = distance(target, h) || 1,
          speed = 130 + s.tier * 15;
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
