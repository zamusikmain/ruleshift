import { ruleTitle } from "./ruleView";
import { formatTime } from "./config";
import { t } from "./locales";
import { type RuleSnapshot } from "./shared/ruleEngine";
import { ruleStatus } from "./ruleView";
export function showHud(
  hp: number,
  score: number,
  time: number,
  rules: RuleSnapshot,
  streak: number,
  alive?: number,
): void {
  const hud = document.querySelector<HTMLElement>("#hud")!;
  hud.hidden = false;
  const name = rules.phase === "rest" ? t("recover") : ruleTitle(rules);
  hud.innerHTML = `<div class="hud-side"><small>${hp ? t("integrity") : t("spectator")}</small><span style="color:${hp === 1 ? "#ff647d" : "#b9fa6a"}">${"♥".repeat(hp)}${"♡".repeat(3 - hp)}</span><small>${alive === undefined ? t(time >= 60 ? "hard" : time >= 30 ? "normal" : "easy") : `${t("alive")} ${alive}`}</small></div><div class="hud-rule">${name}<small>${rules.ids.length > 1 && rules.phase !== "rest" ? `${t("combo")} · ` : ""}${ruleStatus(rules)}</small><progress max="1" value="${Math.max(0, rules.remaining / (rules.phase === "rest" ? 2.5 : rules.phase === "announce" ? 1.5 : rules.duration))}"></progress></div><div class="hud-score">${score}<small>${t("score")} · ${formatTime(time)}</small><small>${t("streak")} ×${Math.min(5, streak)}</small></div>`;
}
export function hideHud(): void {
  document.querySelector<HTMLElement>("#hud")!.hidden = true;
}
