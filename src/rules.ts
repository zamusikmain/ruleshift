import Phaser from "phaser";
import { RuleEngine, RULE_DEFS } from "./shared/ruleEngine";
import { RuleView, ruleStatus, ruleTitle, ruleSubtitle } from "./ruleView";
import { t } from "./locales";
import type { Player } from "./player";
export const RULES = RULE_DEFS;
export class RuleSystem {
  readonly engine = new RuleEngine({
    pick: (values) => Phaser.Utils.Array.GetRandom(values),
    between: (min, max) => Phaser.Math.Between(min, max),
    shuffle: (values) => Phaser.Utils.Array.Shuffle(values),
  });
  private view: RuleView;
  constructor(
    scene: Phaser.Scene,
    private player: Player,
    private announce: (title: string, subtitle: string, color: number) => void,
    private hit: () => boolean | void,
    private reward: (count: number) => void,
    private fail: () => void = () => {},
    private near: () => void = () => {},
  ) {
    this.view = new RuleView(scene);
  }
  get phase() {
    return this.engine.state.phase;
  }
  get index() {
    return this.engine.state.ids[0] ?? -1;
  }
  get remaining() {
    return this.engine.state.remaining;
  }
  get status() {
    return ruleStatus(this.engine.state);
  }
  get progress() {
    return Math.max(
      0,
      this.remaining /
        (this.phase === "rest" ? 2.5 : this.engine.state.duration),
    );
  }
  update(dt: number, survival: number): void {
    const serial = this.engine.state.serial;
    this.engine.update(
      dt,
      survival,
      [
        {
          id: "solo",
          x: this.player.x,
          y: this.player.y,
          radius: this.player.radius,
          distance: this.player.distance,
          hp: this.player.hp,
          damageTaken: this.player.state?.damageTaken,
        },
      ],
      this.hit,
      (_, count) => this.reward(count),
      this.fail,
      this.near,
    );
    const s = this.engine.state;
    if (s.serial !== serial)
      this.announce(
        s.event ? t("overload") : ruleTitle(s),
        ruleSubtitle(s),
        RULES[s.ids[0]].color,
      );
    this.view.draw(s);
  }
}
