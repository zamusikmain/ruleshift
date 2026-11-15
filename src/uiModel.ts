import type { TextKey } from "./locales";
import { OFFLINE_MODES, ONLINE_MODES } from "./shared/modes";
import type { Profile } from "./profile";

export const modeTitle = (mode: string): TextKey =>
  (mode === "chaos" ? "chaosMode" : mode) as TextKey;
export const modeDescription = (mode: string, online = false): TextKey =>
  (online && mode === "classic" ? "cardOnlineClassic" : `card${mode[0].toUpperCase()}${mode.slice(1)}`) as TextKey;
export const modeSymbol: Record<string, string> = {
  classic: "◇", survival: "∞", blitz: "ϟ", chaos: "✦", daily: "◷", lastOneStanding: "◎",
};
export function profileSummary(profile: Profile) {
  return {
    wins: profile.stats.wins,
    matches: profile.stats.soloGames + profile.stats.onlineGames,
    bestStreak: Math.max(0, ...ONLINE_MODES.map(mode => profile.progression.online[mode].bestStreak)),
    achievements: profile.achievements.length,
  };
}
export { OFFLINE_MODES, ONLINE_MODES };
// No account or verified ranking service exists yet. Local XP is never a rating.
export const leaderboardAvailability = () => ({ connected: false, rows: [], currentRank: null } as const);
