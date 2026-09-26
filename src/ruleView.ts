import Phaser from "phaser";
import { ARENA, C, center } from "./config";
import {
  laserY,
  shrinkInset,
  symbolPosition,
  type RuleSnapshot,
} from "./shared/ruleEngine";
import { t } from "./locales";
export const SYMBOLS = ["I", "II", "III"];
export function ruleStatus(s: RuleSnapshot): string {
  if (s.phase === "rest")
    return `${t("next")} · ${Math.max(0, s.remaining).toFixed(1)}`;
  if (s.phase === "announce") return t("prepare");
  if (s.ids.includes(4))
    return s.elapsed < 1.8
      ? `${t("stopIn")} ${(1.8 - s.elapsed).toFixed(1)}`
      : s.elapsed < 3.8
        ? `${t("freeze")} ${(3.8 - s.elapsed).toFixed(1)}`
        : t("released");
  if (s.ids.includes(9))
    return `${t("target")} ${SYMBOLS[s.symbol]} · ${Math.max(0, 3.7 - s.elapsed).toFixed(1)}`;
  if (s.ids.includes(2))
    return `${t("center")} · ${Math.max(0, 4 - s.tier * 0.25 - s.elapsed).toFixed(1)}`;
  return `${t(s.elapsed < 1.5 ? "warning" : s.ids.includes(0) ? "moving" : "active")} · ${Math.max(0, s.remaining).toFixed(1)}`;
}
export class RuleView {
  private graphics: Phaser.GameObjects.Graphics;
  private symbols: Phaser.GameObjects.Text[];
  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(4);
    this.symbols = SYMBOLS.map((symbol, i) =>
      scene.add
        .text(symbolPosition(i).x, center.y, symbol, {
          fontFamily: "Arial",
          fontSize: 26,
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setDepth(5)
        .setVisible(false),
    );
  }
  draw(s: RuleSnapshot): void {
    const g = this.graphics.clear();
    this.symbols.forEach((text) => text.setVisible(false));
    if (s.phase !== "active") return;
    for (const h of s.hazards) {
      const active =
        h.kind === "shot" ||
        (h.kind === "meteor" ? s.elapsed - h.born >= 1.25 : s.elapsed >= 1.5);
      if (h.kind === "zone" && s.elapsed >= s.duration - 0.3) continue;
      g.fillStyle(C.danger, active ? 0.23 : 0.07).fillCircle(
        h.x,
        h.y,
        h.radius,
      );
      g.lineStyle(active ? 3 : 1, C.danger, active ? 1 : 0.6).strokeCircle(
        h.x,
        h.y,
        h.radius,
      );
      if (h.kind === "shot")
        g.fillStyle(0xffdfe5)
          .fillCircle(h.x, h.y, 3)
          .lineStyle(3, C.danger, 0.3)
          .lineBetween(h.x, h.y, h.x - h.vx * 0.08, h.y - h.vy * 0.08);
      else
        g.lineStyle(2, C.danger, 0.8)
          .lineBetween(h.x - 6, h.y - 6, h.x + 6, h.y + 6)
          .lineBetween(h.x + 6, h.y - 6, h.x - 6, h.y + 6);
    }
    if (s.ids.includes(2) && s.elapsed < 4 - s.tier * 0.25) {
      g.fillStyle(C.cyan, 0.12)
        .fillCircle(center.x, center.y, 86)
        .lineStyle(2, C.cyan)
        .strokeCircle(center.x, center.y, 86);
      g.lineStyle(5, C.cyan)
        .beginPath()
        .arc(
          center.x,
          center.y,
          96,
          -Math.PI / 2,
          -Math.PI / 2 +
            Math.PI * 2 * Math.max(0, 1 - s.elapsed / (4 - s.tier * 0.25)),
          false,
        )
        .strokePath();
    }
    if (s.ids.includes(5) && s.elapsed < s.duration - 0.3)
      g.lineStyle(
        s.elapsed < 1.5 ? 2 : 8,
        C.danger,
        s.elapsed < 1.5 ? 0.4 : 1,
      ).lineBetween(ARENA.left + 105, laserY(s), ARENA.right - 105, laserY(s));
    if (s.ids.includes(6)) {
      const inset = shrinkInset(s);
      g.fillStyle(C.danger, 0.15)
        .fillRect(ARENA.left, ARENA.top, inset, ARENA.bottom - ARENA.top)
        .fillRect(
          ARENA.right - inset,
          ARENA.top,
          inset,
          ARENA.bottom - ARENA.top,
        )
        .fillRect(
          ARENA.left + inset,
          ARENA.top,
          ARENA.right - ARENA.left - inset * 2,
          inset * 0.6,
        )
        .fillRect(
          ARENA.left + inset,
          ARENA.bottom - inset * 0.6,
          ARENA.right - ARENA.left - inset * 2,
          inset * 0.6,
        );
      g.lineStyle(2, C.danger, 0.8).strokeRect(
        ARENA.left + inset,
        ARENA.top + inset * 0.6,
        ARENA.right - ARENA.left - inset * 2,
        ARENA.bottom - ARENA.top - inset * 1.2,
      );
    }
    if (s.ids.includes(9) && s.elapsed < 3.7)
      for (let i = 0; i < 3; i++) {
        const pos = symbolPosition(i),
          color = [C.cyan, C.lime, 0xc49bff][i];
        g.fillStyle(color, 0.1)
          .fillCircle(pos.x, pos.y, 80)
          .lineStyle(2, color)
          .strokeCircle(pos.x, pos.y, 80);
        this.symbols[i].setVisible(true);
      }
  }
}
