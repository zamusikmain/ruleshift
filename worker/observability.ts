import { ARENA, WIDTH, HEIGHT } from "../src/config";
import { DASH_COOLDOWN } from "../src/shared/movement";
import { PICKUP_CAP, PICKUP_TTL } from "../src/shared/pickups";
import { PROTOCOL_VERSION } from "../src/shared/protocol";
import { RULE_DEFS, COMPATIBLE_PAIRS } from "../src/shared/ruleEngine";
import {
  MODIFIERS,
  COMBO_PRESSURE,
  EVENT_START,
  EVENT_INTERVAL,
  SUDDEN_DEATH_START,
} from "../src/shared/variants";
import {
  RECONNECT_GRACE,
  ROOM_IDLE_SECONDS,
  type Room,
} from "../src/shared/room";

// Explicit projections: never serialize Room, its members, or a raw snapshot to MCP.
export function gameConfig() {
  return {
    game: "RULESHIFT",
    protocolVersion: PROTOCOL_VERSION,
    world: { width: WIDTH, height: HEIGHT, arena: { ...ARENA } },
    dashCooldownSeconds: DASH_COOLDOWN,
    pickups: { cap: PICKUP_CAP, ttlSeconds: PICKUP_TTL },
    reconnectGraceSeconds: RECONNECT_GRACE,
    roomIdleSeconds: ROOM_IDLE_SECONDS,
    rules: RULE_DEFS.map((rule, id) => ({
      id,
      nameKey: rule.name,
      descriptionKey: rule.description,
    })),
    compatiblePairs: COMPATIBLE_PAIRS.map((pair) => [...pair]),
    modifiers: MODIFIERS,
    comboPressure: COMBO_PRESSURE,
    eventStartSeconds: EVENT_START,
    eventIntervalSeconds: EVENT_INTERVAL,
    suddenDeathStartSeconds: SUDDEN_DEATH_START,
    mutableThroughMcp: false,
  };
}
export function inspectRoom(room: Room | undefined, existed: boolean) {
  if (!room || room.expired)
    return {
      available: false as const,
      reason: room
        ? ("expired" as const)
        : existed
          ? ("reset" as const)
          : ("not_found" as const),
    };
  const members = [...room.members.values()];
  const rules = room.rules.state;
  return {
    available: true as const,
    roomCode: room.code,
    matchId: room.matchId,
    phase: room.phase,
    elapsedSeconds: room.time,
    countdownSeconds: room.countdown,
    players: {
      total: members.length,
      connected: members.filter((m) => m.state.connected).length,
      alive: members.filter((m) => m.state.hp > 0).length,
      ready: members.filter((m) => m.state.ready).length,
    },
    suddenDeath: room.suddenDeath,
    arenaInset: room.arenaInset,
    rules: {
      phase: rules.phase,
      ids: [...rules.ids],
      serial: rules.serial,
      remainingSeconds: rules.remaining,
      direction: rules.direction,
      secondDirection: rules.secondDirection,
      modifiers: { ...rules.modifiers },
      meteorPattern: rules.meteorPattern,
      event: rules.event,
      hazards: rules.hazards.length,
    },
    pickups: room.pickups.items.length,
    result:
      room.phase === "results" ? (room.winnerId ? "winner" : "draw") : null,
  };
}
export type RoomInspection = ReturnType<typeof inspectRoom>;
export interface GameInspectionApi {
  getStatus(): Promise<{
    service: string;
    protocolVersion: number;
    globalMatchIndex: false;
  }>;
  getConfig(): Promise<ReturnType<typeof gameConfig>>;
  inspect(code: string): Promise<RoomInspection>;
}
