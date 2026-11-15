import type { StorageLike } from "./profile";

export const JOYSTICK_SIZES = { small: 104, medium: 136, large: 168 } as const;
export type JoystickSize = keyof typeof JOYSTICK_SIZES;
export const JOYSTICK_DEAD_ZONE = 0.22;
export const JOYSTICK_TRAVEL = 0.32;
export const CONTROL_KEY = "ruleshift.controls.v1";
export type JoystickType = "fixed" | "floating";
export interface ControlOptions { type: JoystickType; sensitivity: number; deadZone: number }
export const OPTIONS_KEY = "ruleshift.controls.v2";
export function loadControlOptions(storage?: StorageLike): ControlOptions {
  const result: ControlOptions = { type: "fixed", sensitivity: 1, deadZone: JOYSTICK_DEAD_ZONE };
  try {
    const value = JSON.parse(storage?.getItem(OPTIONS_KEY) ?? "null");
    if (value?.type === "fixed" || value?.type === "floating") result.type = value.type;
    if (typeof value?.sensitivity === "number" && Number.isFinite(value.sensitivity)) result.sensitivity = Math.max(.5, Math.min(1.5, value.sensitivity));
    if (typeof value?.deadZone === "number" && Number.isFinite(value.deadZone)) result.deadZone = Math.max(.05, Math.min(.4, value.deadZone));
  } catch { /* Preserve defaults and existing size on invalid storage. */ }
  return result;
}
export function validJoystickSize(value: unknown): value is JoystickSize {
  return typeof value === "string" && Object.hasOwn(JOYSTICK_SIZES, value);
}
export function loadJoystickSize(
  storage?: StorageLike,
  touch = false,
): JoystickSize {
  try {
    const saved: unknown = storage?.getItem(CONTROL_KEY);
    if (validJoystickSize(saved)) return saved;
  } catch {
    /* Storage is optional. */
  }
  return touch ? "large" : "medium";
}
let storage: StorageLike | undefined;
try {
  storage = localStorage;
} catch {
  /* In-memory fallback. */
}
export let joystickSize = loadJoystickSize(
  storage,
  typeof navigator !== "undefined" && navigator.maxTouchPoints > 0,
);
export let controlOptions = loadControlOptions(storage);
const PIXELS_KEY = "ruleshift.joystick-pixels.v1";
export let joystickPixels = JOYSTICK_SIZES[joystickSize] as number;
try { const saved = storage?.getItem(PIXELS_KEY); const pixels = saved == null ? NaN : Number(saved); if (Number.isFinite(pixels)) joystickPixels = Math.max(104, Math.min(168, Math.round(pixels))); } catch { /* Keep legacy size. */ }
export function setJoystickPixels(pixels: number): void {
  if (!Number.isFinite(pixels)) return;
  joystickPixels = Math.max(104, Math.min(168, Math.round(pixels)));
  try { storage?.setItem(PIXELS_KEY, String(joystickPixels)); } catch { /* Optional persistence. */ }
  applyJoystickSize();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("controlschange"));
}
export function setControlOptions(value: ControlOptions): void {
  controlOptions = loadControlOptions({ getItem: () => JSON.stringify(value), setItem: () => {} });
  try { storage?.setItem(OPTIONS_KEY, JSON.stringify(controlOptions)); } catch { /* Optional persistence. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("controlschange"));
}
export function applyJoystickSize(): void {
  document.documentElement.style.setProperty(
    "--joystick-size",
    `${joystickPixels}px`,
  );
}
export function setJoystickSize(size: JoystickSize): void {
  if (!validJoystickSize(size)) return;
  joystickSize = size;
  joystickPixels = JOYSTICK_SIZES[size];
  try {
    storage?.setItem(CONTROL_KEY, size);
    storage?.setItem(PIXELS_KEY, String(joystickPixels));
  } catch {
    /* In-memory fallback. */
  }
  applyJoystickSize();
}
