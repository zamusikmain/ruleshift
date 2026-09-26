import { ARENA } from "../config";
export const DIRECTIONS = ["TOP", "RIGHT", "BOTTOM", "LEFT"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export function directionVector(direction: Direction): {
  x: number;
  y: number;
} {
  return {
    TOP: { x: 0, y: 1 },
    RIGHT: { x: -1, y: 0 },
    BOTTOM: { x: 0, y: -1 },
    LEFT: { x: 1, y: 0 },
  }[direction];
}
export function edgeSegment(
  direction: Direction,
  progress = 0,
): { x1: number; y1: number; x2: number; y2: number } {
  const p = Math.max(0, Math.min(1, progress));
  const horizontal = direction === "TOP" || direction === "BOTTOM";
  if (horizontal) {
    const y =
      ARENA.top +
      25 +
      (direction === "TOP" ? p : 1 - p) * (ARENA.bottom - ARENA.top - 50);
    return { x1: ARENA.left + 105, y1: y, x2: ARENA.right - 105, y2: y };
  }
  const x =
    ARENA.left +
    25 +
    (direction === "LEFT" ? p : 1 - p) * (ARENA.right - ARENA.left - 50);
  return { x1: x, y1: ARENA.top + 80, x2: x, y2: ARENA.bottom - 80 };
}
