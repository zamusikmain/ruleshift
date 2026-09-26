import Phaser from 'phaser';
import { ARENA, C, center } from './config';
import { Player } from './player';
export const RULES = [
  { name: 'KEEP MOVING', description: "Don't stop! Keep moving around the arena.", color: C.lime },
  { name: 'DANGER ZONES', description: 'Red circles are about to become dangerous.', color: C.danger },
  { name: 'CENTER NOW', description: 'Reach the safe circle before time runs out.', color: C.cyan },
  { name: 'DODGE', description: 'Incoming projectiles. Stay out of their path.', color: C.danger },
  { name: "DON'T MOVE", description: 'Get ready to stop. Wait for the release.', color: C.cyan },
] as const;
type Zone = { x: number; y: number; radius: number };
type Shot = { x: number; y: number; vx: number; vy: number };
export class RuleSystem {
  phase: 'rest' | 'announce' | 'active' = 'rest';
  index = -1;
  remaining = 2.5;
  status = 'BREATHE. THE NEXT SHIFT IS COMING.';
  progress = 1;
  private elapsed = 0;
  private duration = 0;
  private idle = 0;
  private movement = 0;
  private failed = false;
  private checked = false;
  private shots: Shot[] = [];
  private zones: Zone[] = [];
  private nextShot = 0;
  private tier = 0;
  private graphics: Phaser.GameObjects.Graphics;
  constructor(scene: Phaser.Scene, private player: Player, private announce: (title: string, subtitle: string, color: number) => void, private hit: () => void, private reward: () => void) {
    this.graphics = scene.add.graphics().setDepth(4);
  }
  update(dt: number, survival: number): void {
    this.remaining -= dt;
    this.tier = survival >= 60 ? 2 : survival >= 30 ? 1 : 0;
    if (this.phase === 'rest') {
      this.progress = Math.max(0, this.remaining / 2.5);
      this.status = `NEXT SHIFT IN ${Math.max(0, this.remaining).toFixed(1)}s`;
      if (this.remaining <= 0) {
        const choices = RULES.map((_, i) => i).filter(i => i !== this.index);
        this.index = Phaser.Utils.Array.GetRandom(choices);
        this.phase = 'announce'; this.remaining = 1.5;
        const rule = RULES[this.index]; this.announce(rule.name, rule.description, rule.color);
      }
      return;
    }
    if (this.phase === 'announce') {
      this.status = 'PREPARE FOR THE SHIFT'; this.progress = 1;
      if (this.remaining <= 0) this.start();
      return;
    }
    this.elapsed += dt;
    this.progress = Math.max(0, this.remaining / this.duration);
    this.graphics.clear();
    switch (this.index) {
      case 0:
        this.idle = this.player.distance / dt < 12 ? this.idle + dt : 0;
        this.status = this.idle > .3 ? `KEEP MOVING! ${(1.2 - this.idle).toFixed(1)}s` : 'STAY IN MOTION';
        if (this.idle >= 1.2) { this.violation(); this.idle = 0; }
        break;
      case 1: this.updateZones(); break;
      case 2: this.updateCenter(); break;
      case 3: this.updateShots(dt); break;
      case 4:
        if (this.elapsed < 1.8) this.status = `STOP IN ${(1.8 - this.elapsed).toFixed(1)}s`;
        else if (this.elapsed < 3.8) {
          this.status = `FREEZE — ${(3.8 - this.elapsed).toFixed(1)}s`;
          this.graphics.lineStyle(2, C.cyan, .6).strokeCircle(this.player.x, this.player.y, 32);
          this.movement += this.player.distance;
          if (this.movement > 10) { this.violation(); this.movement = 0; }
        } else this.status = 'RELEASED — YOU CAN MOVE';
        break;
    }
    if (this.remaining <= 0) {
      this.graphics.clear(); this.shots = []; this.zones = [];
      if (!this.failed) this.reward();
      this.phase = 'rest'; this.remaining = 2.5;
    }
  }
  private start(): void {
    this.phase = 'active'; this.duration = 6 - this.tier;
    this.remaining = this.duration; this.elapsed = 0; this.idle = 0; this.movement = 0; this.failed = false; this.checked = false; this.nextShot = .2;
    this.shots = []; this.zones = [];
    if (this.index === 1) {
      // A spaced lattice prevents overlapping circles from sealing the entire arena.
      const cells = Phaser.Utils.Array.Shuffle(Array.from({ length: 12 }, (_, i) => i));
      for (const cell of cells.slice(0, 4 + this.tier)) this.zones.push({ x: 180 + (cell % 4) * 260 + Phaser.Math.Between(-25, 25), y: 235 + Math.floor(cell / 4) * 160, radius: 66 + this.tier * 6 });
    }
  }
  private violation(): void { this.failed = true; this.hit(); }
  private updateZones(): void {
    const active = this.elapsed >= 1.5 && this.elapsed < this.duration - .3;
    this.status = this.elapsed < 1.5 ? `CLEAR THE RED ZONES — ${(1.5 - this.elapsed).toFixed(1)}s` : active ? 'DANGER ZONES ACTIVE' : 'ZONES CLEARED';
    if (this.elapsed >= this.duration - .3) return;
    for (const zone of this.zones) {
      this.graphics.fillStyle(C.danger, active ? .26 : .07).fillCircle(zone.x, zone.y, zone.radius);
      this.graphics.lineStyle(active ? 3 : 1, C.danger, active ? .95 : .5).strokeCircle(zone.x, zone.y, zone.radius);
      this.graphics.lineStyle(2, C.danger, .65).lineBetween(zone.x - 6, zone.y - 6, zone.x + 6, zone.y + 6).lineBetween(zone.x + 6, zone.y - 6, zone.x - 6, zone.y + 6);
      if (active && Phaser.Math.Distance.Between(this.player.x, this.player.y, zone.x, zone.y) < zone.radius + this.player.radius) this.violation();
    }
  }
  private updateCenter(): void {
    const deadline = 4 - this.tier * .25;
    const inside = Phaser.Math.Distance.Between(this.player.x, this.player.y, center.x, center.y) <= 86 - this.player.radius;
    if (!this.checked) {
      this.graphics.fillStyle(C.cyan, inside ? .18 : .07).fillCircle(center.x, center.y, 86);
      this.graphics.lineStyle(2, C.cyan, .8).strokeCircle(center.x, center.y, 86);
      this.graphics.lineStyle(5, C.cyan).beginPath().arc(center.x, center.y, 96, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, 1 - this.elapsed / deadline), false).strokePath();
      this.status = `${inside ? 'SAFE — STAY HERE' : 'REACH THE CENTER'} · ${Math.max(0, deadline - this.elapsed).toFixed(1)}s`;
      if (this.elapsed >= deadline) { this.checked = true; if (!inside) this.violation(); this.status = inside ? 'CENTER REACHED' : 'CENTER MISSED'; this.graphics.clear(); }
    }
  }
  private updateShots(dt: number): void {
    this.status = 'INCOMING — KEEP YOUR DISTANCE';
    this.nextShot -= dt;
    if (this.nextShot <= 0 && this.remaining > 1.2) {
      this.nextShot = .85 - this.tier * .15;
      const side = Phaser.Math.Between(0, 3);
      let x = side < 2 ? (side === 0 ? ARENA.left : ARENA.right) : Phaser.Math.Between(ARENA.left, ARENA.right);
      let y = side >= 2 ? (side === 2 ? ARENA.top : ARENA.bottom) : Phaser.Math.Between(ARENA.top, ARENA.bottom);
      // Never spawn beside the player: opposite-edge fallback guarantees reaction distance.
      if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 300) { x = this.player.x < center.x ? ARENA.right : ARENA.left; y = this.player.y < center.y ? ARENA.bottom : ARENA.top; }
      const direction = new Phaser.Math.Vector2(this.player.x - x, this.player.y - y).normalize().scale(210 + this.tier * 35);
      this.shots.push({ x, y, vx: direction.x, vy: direction.y });
    }
    this.shots = this.shots.filter(s => s.x >= ARENA.left - 15 && s.x <= ARENA.right + 15 && s.y >= ARENA.top - 15 && s.y <= ARENA.bottom + 15);
    for (const shot of this.shots) {
      shot.x += shot.vx * dt; shot.y += shot.vy * dt;
      this.graphics.lineStyle(3, C.danger, .3).lineBetween(shot.x, shot.y, shot.x - shot.vx * .085, shot.y - shot.vy * .085);
      this.graphics.fillStyle(C.danger, .12).fillCircle(shot.x, shot.y, 16).fillStyle(C.danger).fillCircle(shot.x, shot.y, 7).fillStyle(0xffdfe5).fillCircle(shot.x, shot.y, 3);
      if (Phaser.Math.Distance.Between(shot.x, shot.y, this.player.x, this.player.y) < this.player.radius + 7) { this.violation(); shot.x = -100; }
    }
  }
}
