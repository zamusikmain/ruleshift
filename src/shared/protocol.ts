import { validateName, validColor } from "./identity";
import type { Pickup } from "./pickups";
import type { Body } from "./movement";
import type { RuleSnapshot } from "./ruleEngine";
export const PROTOCOL_VERSION = 2;
export type ErrorCode =
  | "roomNotFound"
  | "roomFull"
  | "matchStarted"
  | "invalidMessage"
  | "rateLimit"
  | "roomExpired"
  | "connectionLost"
  | "versionMismatch"
  | "matchReset";
export type ClientMessage =
  | { type: "hello"; name: string; color: number; token?: string; protocol?: number }
  | { type: "input"; x: number; y: number }
  | { type: "ready"; ready: boolean }
  | { type: "start" | "rematch" | "leave" | "ping" | "dash" | "shockwave" };
export interface PlayerSnapshot extends Body {
  id: string;
  name: string;
  color: number;
  ready: boolean;
  connected: boolean;
  eliminatedAt: number | null;
  score: number;
  rules: number;
  chaos: number;
  streak: number;
  bestStreak: number;
  flawless: number;
  perfects: number;
  nearMisses: number;
  placement: number;
}
export interface RoomSnapshot {
  type: "state";
  protocol: number;
  code: string;
  phase: "lobby" | "countdown" | "playing" | "results";
  hostId: string;
  matchId: number;
  players: PlayerSnapshot[];
  time: number;
  countdown: number;
  winnerId: string | null;
  rules: RuleSnapshot;
  pickups: Pickup[];
  suddenDeath: boolean;
  arenaInset: number;
}
export type ServerMessage =
  | RoomSnapshot
  | { type: "welcome"; id: string; token: string }
  | { type: "error"; code: ErrorCode }
  | { type: "pong" };
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "string" || raw.length > 512) return null;
  let m: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    m = value as Record<string, unknown>;
  } catch {
    return null;
  }
  const keys = (...allowed: string[]) =>
    Object.keys(m).every((key) => ["type", ...allowed].includes(key));
  if (m.type === "hello" && keys("name", "color", "token", "protocol")) {
    const name = validateName(m.name);
    if (
      !name ||
      !validColor(m.color) ||
      (m.protocol !== undefined && (typeof m.protocol !== "number" || !Number.isSafeInteger(m.protocol) || m.protocol < 1)) ||
      (m.token !== undefined &&
        (typeof m.token !== "string" || !/^[a-f0-9-]{36}$/.test(m.token)))
    )
      return null;
    return {
      type: "hello",
      name,
      color: m.color,
      ...(m.protocol !== undefined ? { protocol: m.protocol as number } : {}),
      ...(m.token ? { token: m.token as string } : {}),
    };
  }
  if (
    m.type === "input" &&
    keys("x", "y") &&
    typeof m.x === "number" &&
    typeof m.y === "number" &&
    Number.isFinite(m.x) &&
    Number.isFinite(m.y) &&
    Math.abs(m.x) <= 1 &&
    Math.abs(m.y) <= 1 &&
    Math.hypot(m.x, m.y) <= 1.001
  )
    return { type: "input", x: m.x, y: m.y };
  if (m.type === "ready" && keys("ready") && typeof m.ready === "boolean")
    return { type: "ready", ready: m.ready };
  if (
    (m.type === "start" ||
      m.type === "rematch" ||
      m.type === "leave" ||
      m.type === "ping" ||
      m.type === "dash" ||
      m.type === "shockwave") &&
    keys()
  )
    return { type: m.type };
  return null;
}
