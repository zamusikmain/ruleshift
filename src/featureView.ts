import Phaser from "phaser";
import { ARENA } from "./config";
import { t } from "./locales";
import { audio } from "./audio";
import type { Body } from "./shared/movement";
import type { Pickup } from "./shared/pickups";

const PICKUP_STYLE = {
  shield: { color: 0x65dce9, icon: "◇" },
  speed: { color: 0xffc65c, icon: "»" },
  heal: { color: 0xb9fa6a, icon: "+" },
  scoreBoost: { color: 0xc49bff, icon: "×2" },
  shockwave: { color: 0xff94dc, icon: "◎" },
};
type VisibleBody = Body & {
  id: string;
  perfects?: number;
  nearMisses?: number;
};
export class FeatureView {
  private graphics: Phaser.GameObjects.Graphics;
  private labels = new Map<number, Phaser.GameObjects.Text>();
  private previous = new Map<
    string,
    {
      dash: number;
      wave: number;
      pickups: number;
      perfects: number;
      near: number;
      shield: boolean;
    }
  >();
  private effects: { x: number; y: number; age: number; color: number }[] = [];
  constructor(private scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(8);
  }
  draw(
    items: Pickup[],
    players: VisibleBody[],
    localId: string,
    dt: number,
    inset = 0,
  ): void {
    const g = this.graphics.clear();
    for (const [id, label] of this.labels)
      if (!items.some((item) => item.id === id)) {
        label.destroy();
        this.labels.delete(id);
      }
    for (const item of items) {
      const style = PICKUP_STYLE[item.kind];
      let label = this.labels.get(item.id);
      if (!label) {
        label = this.scene.add
          .text(item.x, item.y, style.icon, {
            fontFamily: "Arial",
            fontSize: 22,
            color: `#${style.color.toString(16)}`,
          })
          .setOrigin(0.5)
          .setDepth(9);
        this.labels.set(item.id, label);
        this.effects.push({ x: item.x, y: item.y, age: 0, color: style.color });
      }
      label
        .setVisible(true)
        .setPosition(item.x, item.y)
        .setAlpha(item.ttl < 2 ? 0.55 : 1);
      g.fillStyle(style.color, 0.12).fillCircle(item.x, item.y, 20);
      g.lineStyle(2, style.color, 0.8).strokeCircle(
        item.x,
        item.y,
        20 + Math.sin(item.ttl * 5) * 2,
      );
    }
    for (const p of players) {
      const current = {
        dash: p.dashSerial,
        wave: p.waveSerial,
        pickups: p.pickups,
        perfects: p.perfects ?? 0,
        near: p.nearMisses ?? 0,
        shield: p.shield,
      };
      const old = this.previous.get(p.id);
      this.previous.set(p.id, current);
      if (p.hp <= 0) continue;
      if (p.shield)
        g.lineStyle(2, 0x65dce9, 0.9).strokeCircle(p.x, p.y, p.radius + 7);
      if (p.speedTime > 0)
        g.lineStyle(2, 0xffc65c, 0.5).strokeCircle(p.x, p.y, p.radius + 11);
      if (p.dashTime > 0)
        g.lineStyle(12, 0x65dce9, 0.35).lineBetween(
          p.x,
          p.y,
          p.x - p.dashX * 70,
          p.y - p.dashY * 70,
        );
      if (p.waveTime > 0)
        g.lineStyle(4, 0xff94dc, p.waveTime * 1.5).strokeCircle(
          p.x,
          p.y,
          170 * (1 - p.waveTime / 0.5),
        );
      if (!old) continue;
      if (current.pickups > old.pickups || (old.shield && !p.shield))
        this.effects.push({ x: p.x, y: p.y, age: 0, color: 0x65dce9 });
      if (p.id === localId) {
        if (current.dash > old.dash) audio.play("dash");
        if (current.wave > old.wave) audio.play("wave");
        if (current.pickups > old.pickups) {
          audio.play("pickup");
          this.popup(p.x, p.y, t(p.lastPickup ?? "shield"));
        }
        if (current.perfects > old.perfects) {
          audio.play("success");
          this.popup(p.x, p.y, t("perfect"));
        }
        if (current.near > old.near) {
          audio.play("near");
          this.popup(p.x, p.y - 25, t("nearMiss"));
        }
      }
    }
    this.effects = this.effects
      .filter((e) => {
        e.age += dt;
        return e.age < 0.5;
      })
      .slice(-24);
    for (const e of this.effects)
      g.lineStyle(2, e.color, 1 - e.age * 2).strokeCircle(
        e.x,
        e.y,
        20 + e.age * 55,
      );
    if (inset > 0) {
      g.fillStyle(0xff647d, 0.16)
        .fillRect(ARENA.left, ARENA.top, inset, ARENA.bottom - ARENA.top)
        .fillRect(
          ARENA.right - inset,
          ARENA.top,
          inset,
          ARENA.bottom - ARENA.top,
        );
      g.fillRect(
        ARENA.left + inset,
        ARENA.top,
        ARENA.right - ARENA.left - inset * 2,
        inset * 0.6,
      ).fillRect(
        ARENA.left + inset,
        ARENA.bottom - inset * 0.6,
        ARENA.right - ARENA.left - inset * 2,
        inset * 0.6,
      );
      g.lineStyle(2, 0xff647d).strokeRect(
        ARENA.left + inset,
        ARENA.top + inset * 0.6,
        ARENA.right - ARENA.left - inset * 2,
        ARENA.bottom - ARENA.top - inset * 1.2,
      );
    }
  }
  private popup(x: number, y: number, message: string): void {
    const text = this.scene.add
      .text(x, Math.max(ARENA.top + 24, y - 30), message, {
        fontFamily: "Arial",
        fontSize: 17,
        color: "#b9fa6a",
        backgroundColor: "#0b131e",
      })
      .setOrigin(0.5)
      .setDepth(22);
    this.scene.tweens.add({
      targets: text,
      y: text.y - 24,
      alpha: 0,
      delay: 350,
      duration: 450,
      onComplete: () => text.destroy(),
    });
  }
  hide(): void {
    this.graphics.clear();
    this.labels.forEach((label) => label.setVisible(false));
  }
  reset(): void {
    this.hide();
    this.labels.forEach((label) => label.destroy());
    this.labels.clear();
    this.previous.clear();
    this.effects = [];
  }
  destroy(): void {
    this.reset();
    this.graphics.destroy();
  }
}

export function showAbilities(body: Body, frozen = false): void {
  const dash = document.querySelector<HTMLButtonElement>("#dash-button")!;
  const wave = document.querySelector<HTMLButtonElement>("#wave-button")!;
  dash.hidden = body.hp <= 0;
  wave.hidden = body.hp <= 0 || !body.shockwave;
  dash.textContent = `${t("dash")} ${frozen ? "—" : body.dashCooldown > 0 ? body.dashCooldown.toFixed(1) : "✓"}`;
  dash.setAttribute(
    "aria-label",
    body.dashCooldown > 0 ? dash.textContent : t("dashReady"),
  );
  dash.style.background = `conic-gradient(#224959 ${360 * (1 - body.dashCooldown / 3)}deg, #101a25 0deg)`;
  dash.disabled = frozen || body.dashCooldown > 0;
  wave.textContent = t("shockwave");
  const status = document.querySelector<HTMLElement>("#ability-status")!;
  status.textContent = `${dash.textContent} · ${t("shield")} ${body.shield ? "◇" : "—"}${body.speedTime > 0 ? ` · ${t("speed")} ${body.speedTime.toFixed(0)}` : ""}${body.scoreTime > 0 ? ` · ${t("scoreBoost")} ${body.scoreTime.toFixed(0)}` : ""}`;
}
