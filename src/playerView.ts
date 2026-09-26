import Phaser from "phaser";
import { PALETTE } from "./shared/identity";
export function createPlayerView(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  name = "",
): Phaser.GameObjects.Container {
  const g = scene.add.graphics(),
    tint = PALETTE[color];
  g.fillStyle(tint, 0.07)
    .fillCircle(0, 0, 29)
    .lineStyle(1, tint, 0.28)
    .strokeCircle(0, 0, 21);
  g.fillStyle(tint)
    .fillRoundedRect(-12, -12, 24, 24, 6)
    .fillStyle(0x182b20)
    .fillRoundedRect(-8, -6, 16, 8, 3);
  g.fillStyle(0xf2ffdb).fillRect(-5, -4, 3, 3).fillRect(2, -4, 3, 3);
  const children: Phaser.GameObjects.GameObject[] = [g];
  if (name)
    children.push(
      scene.add
        .text(0, -36, name, {
          fontFamily: "Arial",
          fontSize: 15,
          color: `#${tint.toString(16)}`,
          backgroundColor: "#080d15",
        })
        .setOrigin(0.5),
    );
  return scene.add.container(x, y, children).setDepth(8);
}
