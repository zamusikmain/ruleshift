import type { TextKey } from "../locales/en";
export type Modifier = "fast" | "double" | "giant" | "dense";
export type MeteorPattern =
  "targeted" | "scattered" | "waveRight" | "waveLeft" | "center";
export const MODIFIERS: Readonly<Record<number, readonly Modifier[]>> = {
  3: ["fast", "dense"],
  5: ["fast", "double"],
  8: ["fast", "dense", "giant"],
};
export const MODIFIER_NAMES: Record<Modifier, TextKey> = {
  fast: "fast",
  double: "double",
  giant: "giant",
  dense: "dense",
};
export function validModifier(id: number, modifier: Modifier): boolean {
  return MODIFIERS[id]?.includes(modifier) ?? false;
}
export const COMBO_PRESSURE = 0.75;
export const EVENT_START = 180;
export const EVENT_INTERVAL = 150;
export const SUDDEN_DEATH_START = 180;
export function suddenDeathInset(time: number): number {
  return Math.min(180, Math.max(0, time - SUDDEN_DEATH_START - 5) * 1.5);
}
