import type { RuleSnapshot, RulePlayer } from "./ruleEngine";
import { threatSegment } from "./overdriveHazards";

export const PULSE_RADIUS = 170;
/** One collected charge, consumed by movement.activateShockwave before this call.
 * Only removable enemies/projectiles: never erase walls, mines or warnings. */
export function pulseThreats(state: RuleSnapshot, player: RulePlayer): number {
  if (player.hp <= 0 || state.phase !== "active") return 0;
  const nearby = (x: number, y: number) => Math.hypot(x - player.x, y - player.y) <= PULSE_RADIUS;
  let removed = 0;
  state.hazards = state.hazards.filter(h => {
    const eligible = (h.kind === "hunter" && state.elapsed >= 1.5) || h.kind === "shot";
    if (eligible && nearby(h.x, h.y)) { removed++; return false; }
    return true;
  });
  if (state.swarmTiles?.kind === "swarm" && state.elapsed >= state.swarmTiles.warning) {
    state.swarmTiles.hunters = state.swarmTiles.hunters.filter(h => {
      if (nearby(h.x, h.y)) { removed++; return false; }
      return true;
    });
  }
  for (const layer of state.overdriveLayers ?? (state.overdrive ? [state.overdrive] : [])) {
    if (layer.kind !== "bulletStorm") continue;
    layer.threats = layer.threats.filter(h => {
      const position = threatSegment(h, state.elapsed);
      if (state.elapsed >= h.active && state.elapsed < h.end && nearby(position.x1, position.y1)) { removed++; return false; }
      return true;
    });
  }
  return removed;
}
