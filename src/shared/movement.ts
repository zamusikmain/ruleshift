import { ARENA, center } from "../config";
import type { PickupKind } from "./pickups";
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
  dashCooldown: number;
  dashTime: number;
  dashX: number;
  dashY: number;
  dashSerial: number;
  shield: boolean;
  speedTime: number;
  scoreTime: number;
  pickups: number;
  lastPickup: PickupKind | null;
  damageTaken: number;
  shockwave: boolean;
  waveSerial: number;
  waveTime: number;
  knockTime: number;
  knockX: number;
  knockY: number;
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
    dashCooldown: 0,
    dashTime: 0,
    dashX: 0,
    dashY: 0,
    dashSerial: 0,
    shield: false,
    speedTime: 0,
    scoreTime: 0,
    pickups: 0,
    lastPickup: null,
    damageTaken: 0,
    shockwave: false,
    waveSerial: 0,
    waveTime: 0,
    knockTime: 0,
    knockX: 0,
    knockY: 0,
  };
}
export function normalizeInput(x: number, y: number, deadZone = 0): Movement {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= deadZone) return { x: 0, y: 0 };
  const magnitude = Math.min(1, (length - deadZone) / (1 - deadZone));
  return { x: (x / length) * magnitude, y: (y / length) * magnitude };
}
export function moveBody(body: Body, input: Movement, dt: number): void {
  body.dashCooldown = Math.max(0, body.dashCooldown - dt);
  body.speedTime = Math.max(0, body.speedTime - dt);
  body.scoreTime = Math.max(0, body.scoreTime - dt);
  body.waveTime = Math.max(0, body.waveTime - dt);
  const movement = normalizeInput(input.x, input.y),
    smoothing = 1 - Math.exp(-20 * dt);
  const speed = body.speedTime > 0 ? 345 : 265;
  body.vx += (movement.x * speed - body.vx) * smoothing;
  body.vy += (movement.y * speed - body.vy) * smoothing;
  if (body.dashTime > 0) {
    body.vx = body.dashX * 920;
    body.vy = body.dashY * 920;
  }
  if (body.knockTime > 0) {
    body.vx += body.knockX * 420;
    body.vy += body.knockY * 420;
  }
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
  body.dashTime = Math.max(0, body.dashTime - dt);
  body.knockTime = Math.max(0, body.knockTime - dt);
  if (body.dashTime === 0 && Math.hypot(body.vx, body.vy) > speed) {
    const length = Math.hypot(body.vx, body.vy);
    body.vx *= speed / length;
    body.vy *= speed / length;
  }
}
export const DASH_COOLDOWN = 3;
export function activateDash(
  body: Body,
  input: Movement,
  frozen = false,
): boolean {
  if (
    body.hp <= 0 ||
    body.dashCooldown > 0 ||
    frozen ||
    Math.hypot(input.x, input.y) < 0.25
  )
    return false;
  const length = Math.hypot(input.x, input.y);
  if (!Number.isFinite(length)) return false;
  body.dashX = input.x / length;
  body.dashY = input.y / length;
  body.dashTime = 0.16;
  body.dashCooldown = DASH_COOLDOWN;
  body.dashSerial++;
  return true;
}
export function activateShockwave(body: Body, players: Body[]): boolean {
  if (body.hp <= 0 || !body.shockwave) return false;
  body.shockwave = false;
  body.waveSerial++;
  body.waveTime = 0.5;
  for (const other of players) {
    const dx = other.x - body.x,
      dy = other.y - body.y,
      distance = Math.hypot(dx, dy);
    if (other === body || other.hp <= 0 || distance > 170) continue;
    other.knockX = distance > 0 ? dx / distance : 1;
    other.knockY = distance > 0 ? dy / distance : 0;
    other.knockTime = 0.18;
  }
  return true;
}
export function damageBody(body: Body): boolean {
  if (body.hp <= 0 || body.invulnerable > 0) return false;
  if (body.shield) {
    body.shield = false;
    body.invulnerable = 1;
    return false;
  }
  body.hp--;
  body.damageTaken++;
  body.invulnerable = 1;
  return true;
}
