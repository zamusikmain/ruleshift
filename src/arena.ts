import Phaser from "phaser";
import { ARENA, C, WIDTH, HEIGHT, center } from "./config";
export function drawArena(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  g.fillStyle(0x0b131e).fillRect(0, 0, WIDTH, HEIGHT);
  g.fillStyle(0x0d1923).fillRoundedRect(
    ARENA.left,
    ARENA.top,
    ARENA.right - ARENA.left,
    ARENA.bottom - ARENA.top,
    8,
  );
  g.lineStyle(1, 0x1d303c, 0.5);
  for (let x = ARENA.left + 26; x < ARENA.right; x += 32)
    g.lineBetween(x, ARENA.top, x, ARENA.bottom);
  for (let y = ARENA.top + 30; y < ARENA.bottom; y += 32)
    g.lineBetween(ARENA.left, y, ARENA.right, y);
  g.lineStyle(1, 0x314853).strokeRoundedRect(
    ARENA.left,
    ARENA.top,
    ARENA.right - ARENA.left,
    ARENA.bottom - ARENA.top,
    8,
  );
  for (const [x, y, sx, sy] of [
    [ARENA.left, ARENA.top, 1, 1],
    [ARENA.right, ARENA.top, -1, 1],
    [ARENA.left, ARENA.bottom, 1, -1],
    [ARENA.right, ARENA.bottom, -1, -1],
  ])
    g.lineStyle(3, C.lime, 0.65)
      .lineBetween(x, y + sy * 20, x, y)
      .lineBetween(x, y, x + sx * 20, y);
  g.lineStyle(1, 0x34505b, 0.5)
    .strokeCircle(center.x, center.y, 54)
    .lineBetween(center.x - 12, center.y, center.x + 12, center.y)
    .lineBetween(center.x, center.y - 12, center.x, center.y + 12);
}
