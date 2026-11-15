export const OFFLINE_MODES = [
  "classic",
  "survival",
  "blitz",
  "chaos",
  "daily",
] as const;
export const ONLINE_MODES = [
  "classic",
  "lastOneStanding",
  "blitz",
  "chaos",
] as const;

export type OfflineMode = (typeof OFFLINE_MODES)[number];
export type OnlineMode = (typeof ONLINE_MODES)[number];

export const isOfflineMode = (value: unknown): value is OfflineMode =>
  typeof value === "string" && OFFLINE_MODES.includes(value as OfflineMode);
export const isOnlineMode = (value: unknown): value is OnlineMode =>
  typeof value === "string" && ONLINE_MODES.includes(value as OnlineMode);

export interface ModeRules {
  rest: number;
  announce: number;
  duration: number;
  timeLimit: number | null;
  chaos: boolean;
}

export function modeRules(mode: OfflineMode | OnlineMode): ModeRules {
  switch (mode) {
    case "blitz":
      return { rest: 0.2, announce: 0.75, duration: 3.25, timeLimit: 90, chaos: false };
    case "chaos":
      return { rest: 0.2, announce: 0.9, duration: 4, timeLimit: null, chaos: true };
    case "survival":
      return { rest: 0.6, announce: 1.1, duration: 5, timeLimit: null, chaos: false };
    case "daily":
      return { rest: 1.2, announce: 1, duration: 4.5, timeLimit: 90, chaos: true };
    case "lastOneStanding":
      return { rest: 0.55, announce: 1.1, duration: 4.5, timeLimit: null, chaos: false };
    default:
      return { rest: 0.7, announce: 1.5, duration: 6, timeLimit: null, chaos: false };
  }
}

/** A stable, non-secret daily seed derived from UTC calendar date. */
export function dailySeed(date = new Date()): number {
  const day = date.toISOString().slice(0, 10);
  let hash = 2166136261;
  for (const char of day) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** Server-clock windows; greater intensity changes selection/rest, never reaction. */
export function overdrivePhase(mode:OfflineMode|OnlineMode,time:number): {intensity:0|1|2|3;remaining:number} {
  if(mode==='daily') return {intensity:0,remaining:0};
  const [start,cycle,length,level]=mode==='chaos'?[20,35,24,3]:mode==='blitz'?[25,25,15,2]:mode==='survival'?[45,60,22,1]:mode==='lastOneStanding'?[40,50,20,2]:[60,75,18,1];
  if(time<start) return {intensity:0,remaining:0};
  const elapsed=(time-start)%cycle;
  if(elapsed>=length) return {intensity:0,remaining:0};
  const intensity=mode==='survival'?Math.min(3,1+Math.floor((time-start)/120)):level;
  return {intensity:intensity as 1|2|3,remaining:length-elapsed};
}
