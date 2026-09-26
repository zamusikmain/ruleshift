import Phaser from 'phaser';
import { ARENA, C, center } from './config';
export class Player {
  readonly body: Phaser.GameObjects.Container;
  readonly radius = 12;
  hp = 3;
  distance = 0;
  invulnerable = 0;
  private velocity = new Phaser.Math.Vector2();
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private trail = 0;
  constructor(private scene: Phaser.Scene) {
    const g = scene.add.graphics();
    g.fillStyle(C.lime, 0.07).fillCircle(0, 0, 29);
    g.lineStyle(1, C.lime, 0.28).strokeCircle(0, 0, 21);
    g.fillStyle(C.lime).fillRoundedRect(-12, -12, 24, 24, 6);
    g.fillStyle(0x182b20).fillRoundedRect(-8, -6, 16, 8, 3);
    g.fillStyle(0xf2ffdb).fillRect(-5, -4, 3, 3).fillRect(2, -4, 3, 3);
    this.body = scene.add.container(center.x, center.y, [g]).setDepth(8);
    this.keys = scene.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
  }
  get x(): number { return this.body.x; }
  get y(): number { return this.body.y; }
  update(dt: number): void {
    const k = this.keys;
    const input = new Phaser.Math.Vector2(Number(k.D.isDown || k.RIGHT.isDown) - Number(k.A.isDown || k.LEFT.isDown), Number(k.S.isDown || k.DOWN.isDown) - Number(k.W.isDown || k.UP.isDown));
    input.normalize().scale(265);
    this.velocity.lerp(input, 1 - Math.exp(-20 * dt));
    const x = this.x, y = this.y;
    this.body.x = Phaser.Math.Clamp(x + this.velocity.x * dt, ARENA.left + this.radius, ARENA.right - this.radius);
    this.body.y = Phaser.Math.Clamp(y + this.velocity.y * dt, ARENA.top + this.radius, ARENA.bottom - this.radius);
    this.distance = Phaser.Math.Distance.Between(x, y, this.x, this.y);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.body.alpha = this.invulnerable > 0 ? (Math.floor(this.invulnerable * 15) % 2 ? 0.3 : 1) : 1;
    this.trail -= dt;
    if (this.distance > .5 && this.trail <= 0) {
      this.trail = .055;
      const mote = this.scene.add.circle(x, y, 3, C.lime, .35).setDepth(3);
      this.scene.tweens.add({ targets: mote, alpha: 0, scale: .1, duration: 320, onComplete: () => mote.destroy() });
    }
  }
  damage(): boolean {
    if (this.invulnerable > 0 || this.hp <= 0) return false;
    this.hp--; this.invulnerable = 1;
    this.scene.cameras.main.shake(150, .003);
    this.scene.cameras.main.flash(100, 130, 20, 40);
    return true;
  }
}
