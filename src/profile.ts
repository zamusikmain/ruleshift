import { validateName, validColor } from "./shared/identity";
import type { TextKey } from "./locales/en";
import { blankProgress,readProgress,type OfflineProgress } from "./shared/offlineProgress";
import { blankProgression,readProgression,type Progression } from "./shared/progression";
export const ACHIEVEMENTS = [
  "first",
  "survivor",
  "untouchable",
  "chaosMaster",
  "veteran",
  "ruleBreaker",
  "onlineWinner",
  "streakMaster",
  "onlineFive", "onlineStreak3", "survival300", "dailyFirst", "dailySeven", "events100", "precision20", "chaosFive", "cleanBlitz",
] as const satisfies readonly TextKey[];
export type Achievement = (typeof ACHIEVEMENTS)[number];
export interface Stats {
  best: number;
  longest: number;
  soloGames: number;
  onlineGames: number;
  wins: number;
  rules: number;
  chaos: number;
  flawless: number;
  streak: number;
}
export interface Profile {
  version: 1;
  name: string;
  color: number;
  sound: boolean;
  stats: Stats;
  achievements: Achievement[];
  offline: OfflineProgress;
  progression: Progression;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const KEY = "ruleshift.profile.v1";
const zeroStats = (): Stats => ({
  best: 0,
  longest: 0,
  soloGames: 0,
  onlineGames: 0,
  wins: 0,
  rules: 0,
  chaos: 0,
  flawless: 0,
  streak: 0,
});
export function loadProfile(storage?: StorageLike): Profile {
  const profile: Profile = {
    version: 1,
    name: "",
    color: 0,
    sound: true,
    stats: zeroStats(),
    achievements: [],
    offline: blankProgress(),
    progression: blankProgression(),
  };
  try {
    const saved = JSON.parse(
      storage?.getItem(KEY) ?? "null",
    ) as Partial<Profile> | null;
    if (saved?.version === 1) {
      profile.offline=readProgress(saved.offline);
      profile.progression=readProgression(saved.progression);
      if(!saved.progression) {
        const s=profile.offline.survival,r=profile.progression.offline.survival;
        Object.assign(r,{games:s.games,bestTime:s.bestTime,bestScore:s.bestScore,bestEvents:s.bestEvents,totalEvents:s.totalEvents});
        for(const day of profile.offline.daily) {
          const d=profile.progression.offline.daily;d.games+=day.attempts;
          d.bestTime=Math.max(d.bestTime,day.time);d.bestScore=Math.max(d.bestScore,day.score);d.bestEvents=Math.max(d.bestEvents,day.events);
          if(day.rewarded) profile.progression.dailyAwards.push(day.date);
        }
      }
      profile.name = validateName(saved.name) ?? "";
      profile.color = validColor(saved.color) ? saved.color : 0;
      profile.sound = saved.sound !== false;
      for (const key of Object.keys(profile.stats) as (keyof Stats)[]) {
        const n = saved.stats?.[key];
        if (typeof n === "number" && Number.isFinite(n) && n >= 0)
          profile.stats[key] = Math.min(
            key === "longest" || key === "flawless" ? n : Math.floor(n),
            1e9,
          );
      }
      profile.achievements = ACHIEVEMENTS.filter(
        (id) =>
          Array.isArray(saved.achievements) && saved.achievements.includes(id),
      );
    }
    const old = Number(storage?.getItem("ruleshift.best"));
    if (Number.isFinite(old) && old > 0)
      profile.stats.best = Math.max(profile.stats.best, Math.floor(old));
  } catch {
    /* Corrupt or disabled storage must not prevent play. */
  }
  return profile;
}
let browserStorage: StorageLike | undefined;
try {
  browserStorage = localStorage;
} catch {
  /* In-memory profile remains usable. */
}
export const profile = loadProfile(browserStorage);
export function persistProfile(
  value: Profile = profile,
  storage = browserStorage,
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(value));
  } catch {
    /* In-memory fallback. */
  }
}
export function unlockAchievements(value: Profile): Achievement[] {
  const s = value.stats;
  const p=value.progression,online=Object.values(p.online),offline=Object.values(p.offline);
  const passed = [
    s.longest >= 30,
    s.longest >= 60,
    s.flawless >= 30,
    s.chaos >= 1,
    s.soloGames + s.onlineGames >= 10,
    s.rules >= 50,
    s.wins >= 1,
    s.streak >= 5,
    online.reduce((n,r)=>n+r.wins,0)>=5,
    online.some(r=>r.bestStreak>=3),
    p.offline.survival.bestTime>=300,
    value.offline.localDailyMedals>=1,
    value.offline.localDailyMedals>=7,
    [...online,...offline].reduce((n,r)=>n+r.totalEvents,0)>=100,
    [...online,...offline].some(r=>r.bestPerfects>=20),
    p.offline.chaos.bestCombos>=5||p.online.chaos.bestCombos>=5,
    p.offline.blitz.cleanBlitz,
  ];
  const fresh = ACHIEVEMENTS.filter(
    (id, index) => passed[index] && !value.achievements.includes(id),
  );
  value.achievements.push(...fresh);
  return fresh;
}
