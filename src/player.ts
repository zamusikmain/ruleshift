import Phaser from "phaser";
import {
  createBody,
  moveBody,
  damageBody,
  activateDash,
} from "./shared/movement";
import { UnifiedInput } from "./input";
import { createPlayerView } from "./playerView";
import { profile } from "./profile";
import { PALETTE } from "./shared/identity";
export class Player {
  readonly body: Phaser.GameObjects.Container;
  readonly radius = 12;
  readonly state = createBody();
  get hp() {
    return this.state.hp;
  }
  get distance() {
    return this.state.distance;
  }
  get invulnerable() {
    return this.state.invulnerable;
  }
  private trail = 0;
  constructor(
    private scene: Phaser.Scene,
    private input: UnifiedInput,
  ) {
    this.body = createPlayerView(
      scene,
      this.state.x,
      this.state.y,
      profile.color,
    );
  }
  get x(): number {
    return this.body.x;
  }
  get y(): number {
    return this.body.y;
  }
  update(dt: number, frozen = false): void {
    const x = this.x,
      y = this.y;
    const movement = this.input.read();
    if (this.input.consumeDash()) activateDash(this.state, movement, frozen);
    if (frozen && Math.hypot(movement.x, movement.y) < 0.1) {
      this.state.vx = this.state.vy = 0;
      this.state.dashTime = 0;
    }
    moveBody(this.state, movement, dt);
    this.body.setPosition(this.state.x, this.state.y);
    this.body.alpha =
      this.invulnerable > 0
        ? Math.floor(this.invulnerable * 15) % 2
          ? 0.3
          : 1
        : 1;
    this.trail -= dt;
    if (this.distance > 0.5 && this.trail <= 0) {
      this.trail = 0.055;
      const mote = this.scene.add
        .circle(x, y, 3, PALETTE[profile.color], 0.35)
        .setDepth(3);
      this.scene.tweens.add({
        targets: mote,
        alpha: 0,
        scale: 0.1,
        duration: 320,
        onComplete: () => mote.destroy(),
      });
    }
  }
  damage(): boolean {
    if (!damageBody(this.state)) return false;
    this.scene.cameras.main.shake(150, 0.003);
    this.scene.cameras.main.flash(100, 130, 20, 40);
    return true;
  }
}
