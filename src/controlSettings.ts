import type { StorageLike } from "./profile";

export const JOYSTICK_SIZES = { small: 104, medium: 136, large: 168 } as const;
export type JoystickSize = keyof typeof JOYSTICK_SIZES;
export const JOYSTICK_DEAD_ZONE = 0.22;
export const JOYSTICK_TRAVEL = 0.32;
export const CONTROL_KEY = "ruleshift.controls.v1";
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
export function applyJoystickSize(): void {
  document.documentElement.style.setProperty(
    "--joystick-size",
    `${JOYSTICK_SIZES[joystickSize]}px`,
  );
}
export function setJoystickSize(size: JoystickSize): void {
  if (!validJoystickSize(size)) return;
  joystickSize = size;
  try {
    storage?.setItem(CONTROL_KEY, size);
  } catch {
    /* In-memory fallback. */
  }
  applyJoystickSize();
}
