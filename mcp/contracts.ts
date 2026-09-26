import { z } from "zod";
import type { GameInspectionApi } from "../worker/observability";

export const roomCode = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/);
export const principalSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
    role: z.enum(["reader", "operator"]),
  })
  .strict();
export type Principal = z.infer<typeof principalSchema>;
export const monitorSchema = z
  .object({
    roomCode,
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type MonitorInput = z.infer<typeof monitorSchema>;
export const TOOL_NAMES = [
  "get_game_status",
  "get_active_matches",
  "get_match_details",
  "get_game_config",
  "get_server_stats",
  "get_recent_events",
  "watch_room",
  "unwatch_room",
] as const;
export const auditSchema = z
  .object({
    actor: principalSchema,
    action: z.enum([...TOOL_NAMES, "unknown_tool"]),
    outcome: z.enum(["attempt", "success", "error", "denied", "conflict"]),
  })
  .strict();
export type AuditInput = z.infer<typeof auditSchema>;
export interface AuditEvent extends AuditInput {
  sequence: number;
  at: string;
}
export interface Monitoring {
  revision: number;
  rooms: string[];
}
export interface ControlApi {
  consumeRate(actor: Principal): Promise<boolean>;
  monitoring(): Promise<Monitoring>;
  audit(input: AuditInput): Promise<void>;
  recent(limit: number): Promise<{ events: AuditEvent[]; retention: number }>;
  change(
    actor: Principal,
    operation: "watch_room" | "unwatch_room",
    input: MonitorInput,
  ): Promise<Monitoring>;
}
export interface McpEnv {
  GAME: GameInspectionApi;
  CONTROL: { idFromName(name: string): unknown; get(id: unknown): ControlApi };
  MCP_KEYS?: string;
  MCP_WRITES_ENABLED?: string;
  MCP_ALLOWED_ORIGINS?: string;
}
export class ToolFailure extends Error {
  constructor(
    readonly code:
      | "room_unavailable"
      | "room_not_monitored"
      | "match_changed"
      | "revision_conflict"
      | "monitor_limit"
      | "forbidden"
      | "backend_unavailable",
  ) {
    super(code);
  }
}
