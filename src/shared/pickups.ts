import { ARENA } from "../config";
import type { Body } from "./movement";
import {
  distance,
  type RuleSnapshot,
  type RandomSource,
  shrinkInset,
} from "./ruleEngine";
export type PickupKind =
  "shield" | "speed" | "heal" | "scoreBoost" | "shockwave";
export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  ttl: number;
}
export const PICKUP_TTL = 11;
export const PICKUP_CAP = 3;
export class PickupSystem {
  items: Pickup[] = [];
  private nextSpawn = 6;
  private serial = 0;
  constructor(
    private online = false,
    private random: Pick<RandomSource, "between"> = {
      between: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
    },
  ) {}
  update(
    dt: number,
    players: Body[],
    rules: RuleSnapshot,
    healing = true,
    arenaInset = 0,
  ): void {
    this.nextSpawn -= dt;
    this.items = this.items.filter((item) => {
      item.ttl -= dt;
      return item.ttl > 0 && (healing || item.kind !== "heal");
    });
    if (this.nextSpawn <= 0) {
      this.nextSpawn = 8;
      if (this.items.length < PICKUP_CAP)
        this.spawn(rules, healing, arenaInset);
    }
    for (const player of players) {
      if (player.hp <= 0) continue;
      this.items = this.items.filter((item) => {
        if (
          item.ttl > PICKUP_TTL - 0.4 ||
          distance(player, item) > player.radius + 16
        )
          return true;
        if (item.kind === "heal" && (!healing || player.hp >= 3)) return true;
        if (
          (item.kind === "shield" && player.shield) ||
          (item.kind === "shockwave" && player.shockwave)
        )
          return true;
        applyPickup(player, item.kind);
        return false;
      });
    }
  }
  private spawn(
    rules: RuleSnapshot,
    healing: boolean,
    arenaInset: number,
  ): void {
    const kinds: PickupKind[] = this.online
      ? ["shield", "speed", "heal", "shockwave"]
      : ["shield", "speed", "heal", "scoreBoost"];
    const allowed = kinds.filter((kind) => healing || kind !== "heal");
    const inset = Math.max(
      arenaInset,
      rules.ids.includes(6) ? Math.max(110, shrinkInset(rules)) : 0,
    );
    for (let attempt = 0; attempt < 12; attempt++) {
      const point = {
        x: this.random.between(
          ARENA.left + inset + 40,
          ARENA.right - inset - 40,
        ),
        y: this.random.between(
          ARENA.top + inset * 0.6 + 40,
          ARENA.bottom - inset * 0.6 - 40,
        ),
      };
      if (
        rules.hazards.some((h) => distance(point, h) < h.radius + 45) ||
        this.items.some((p) => distance(point, p) < 90)
      )
        continue;
      this.items.push({
        ...point,
        id: ++this.serial,
        kind: allowed[this.random.between(0, allowed.length - 1)],
        ttl: PICKUP_TTL,
      });
      return;
    }
  }
}
export function applyPickup(player: Body, kind: PickupKind): void {
  if (kind === "shield") player.shield = true;
  if (kind === "speed") player.speedTime = 5;
  if (kind === "heal") player.hp = Math.min(3, player.hp + 1);
  if (kind === "scoreBoost") player.scoreTime = 8;
  if (kind === "shockwave") player.shockwave = true;
  player.pickups++;
  player.lastPickup = kind;
}
