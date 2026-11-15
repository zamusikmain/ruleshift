import type Phaser from "phaser";
export type EffectsLevel="low"|"medium"|"high";
const key="ruleshift.effects.v1";
export function validEffects(value: unknown): value is EffectsLevel {return value==="low"||value==="medium"||value==="high";}
export let effectsLevel: EffectsLevel="medium";
export function reducedMotion(): boolean { return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches; }
try {const value=localStorage.getItem(key);if(validEffects(value)) effectsLevel=value;} catch { /* Optional storage. */ }
export function setEffects(level: EffectsLevel): void {
  effectsLevel=level;
  try {localStorage.setItem(key,level);} catch { /* Gameplay never depends on storage. */ }
}
export function damageEffects(scene: Phaser.Scene): void {
  if (reducedMotion()) return;
  if(effectsLevel!=="low") scene.cameras.main.shake(140,effectsLevel==="high"?.003:.0015);
  scene.cameras.main.flash(effectsLevel==="low"?60:100,effectsLevel==="low"?65:130,20,40);
}
