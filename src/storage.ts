import { profile, persistProfile } from "./profile";

// Preserve the original storage API while using the versioned profile as the source of truth.
export function getBest(): number {
  return profile.stats.best;
}
export function saveBest(score: number): number {
  if (Number.isFinite(score) && score > profile.stats.best) {
    profile.stats.best = Math.floor(score);
    persistProfile();
  }
  return profile.stats.best;
}
