const KEY = 'ruleshift.best';
export function getBest(): number {
  try { const value = Number(localStorage.getItem(KEY)); return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0; } catch { return 0; }
}
export function saveBest(score: number): number {
  const best = Math.max(score, getBest());
  try { localStorage.setItem(KEY, String(best)); } catch { /* Gameplay remains available when storage is disabled. */ }
  return best;
}
