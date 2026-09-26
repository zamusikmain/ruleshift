import { ARENA, center } from "../config";
export interface Movement {
  x: number;
  y: number;
}
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  distance: number;
  hp: number;
  invulnerable: number;
}
export function createBody(x = center.x, y = center.y): Body {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    radius: 12,
    distance: 0,
    hp: 3,
    invulnerable: 0,
  };
}
export function normalizeInput(x: number, y: number, deadZone = 0): Movement {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= deadZone) return { x: 0, y: 0 };
  const magnitude = Math.min(1, (length - deadZone) / (1 - deadZone));
  return { x: (x / length) * magnitude, y: (y / length) * magnitude };
}
export function moveBody(body: Body, input: Movement, dt: number): void {
  const movement = normalizeInput(input.x, input.y),
    smoothing = 1 - Math.exp(-20 * dt);
  body.vx += (movement.x * 265 - body.vx) * smoothing;
  body.vy += (movement.y * 265 - body.vy) * smoothing;
  if (movement.x === 0 && movement.y === 0 && Math.hypot(body.vx, body.vy) < 1)
    body.vx = body.vy = 0;
  const x = body.x,
    y = body.y;
  body.x = Math.max(
    ARENA.left + body.radius,
    Math.min(ARENA.right - body.radius, x + body.vx * dt),
  );
  body.y = Math.max(
    ARENA.top + body.radius,
    Math.min(ARENA.bottom - body.radius, y + body.vy * dt),
  );
  body.distance = Math.hypot(body.x - x, body.y - y);
  body.invulnerable = Math.max(0, body.invulnerable - dt);
}
export function damageBody(body: Body): boolean {
  if (body.hp <= 0 || body.invulnerable > 0) return false;
  body.hp--;
  body.invulnerable = 1;
  return true;
}
