import { applyOverdriveMotion, type Overdrive } from "./shared/overdriveHazards";
import Phaser from "phaser";
import { damageEffects, effectsLevel, reducedMotion } from "./effects";
import {
  createBody,
  moveBody,
  damageBody,
  activateDash,
  activateShockwave,
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
  get intentionallyMoving(): boolean {
    const input = this.input.read();
    return Math.hypot(input.x,input.y) >= .25;
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
  update(dt: number, frozen = false, overdrive?: Overdrive|Overdrive[], elapsed=0, onPulse?: () => void): void {
    const x = this.x,
      y = this.y;
    const movement = this.input.read();
    if (this.input.consumeDash()) activateDash(this.state, movement, frozen);
    if (this.input.consumeWave() && activateShockwave(this.state, [])) onPulse?.();
    if (frozen && Math.hypot(movement.x, movement.y) < 0.1) {
      this.state.vx = this.state.vy = 0;
      this.state.dashTime = 0;
    }
    moveBody(this.state, movement, dt);
    applyOverdriveMotion(overdrive,this.state,elapsed+dt,dt,{x,y});
    this.body.setPosition(this.state.x, this.state.y);
    this.body.alpha =
      this.invulnerable > 0
        ? Math.floor(this.invulnerable * 15) % 2
          ? 0.3
          : 1
        : 1;
    this.trail -= dt;
    if (effectsLevel !== "low" && !reducedMotion() && this.distance > 0.5 && this.trail <= 0) {
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
    damageEffects(this.scene);
    return true;
  }
}
