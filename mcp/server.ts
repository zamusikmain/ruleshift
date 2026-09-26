import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  monitorSchema,
  roomCode,
  ToolFailure,
  type ControlApi,
  type McpEnv,
  type Principal,
} from "./contracts";

const noArgs = z.object({}).strict();
const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const result = (data: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: data,
});
const knownErrors = new Set([
  "room_unavailable",
  "room_not_monitored",
  "match_changed",
  "revision_conflict",
  "monitor_limit",
  "forbidden",
]);

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ToolFailure("backend_unavailable")),
          8000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
export function createMcpServer(
  env: McpEnv,
  actor: Principal,
  control: ControlApi,
): McpServer {
  const server = new McpServer(
    { name: "ruleshift", version: "1.0.0" },
    {
      instructions:
        "Inspect real RULESHIFT room snapshots. Lists cover only explicitly monitored rooms, not every match. No player identities or session secrets are exposed. Write tools only change the monitoring list. Human approval belongs in the MCP client before a write call.",
    },
  );
  const safely = async (action: () => Promise<Record<string, unknown>>) => {
    try {
      return result(await action());
    } catch (error) {
      const code =
        error instanceof Error && knownErrors.has(error.message)
          ? error.message
          : "backend_unavailable";
      return {
        content: [{ type: "text" as const, text: code }],
        isError: true,
      };
    }
  };
  const inspectMonitored = async () => {
    const monitoring = await bounded(control.monitoring());
    const rooms: Record<string, unknown>[] = [];
    // Bound fan-out as well as the stored list. Do not poll from the game tick.
    for (let i = 0; i < monitoring.rooms.length; i += 4) {
      rooms.push(
        ...(await Promise.all(
          monitoring.rooms.slice(i, i + 4).map(async (code) => {
            try {
              return {
                roomCode: code,
                ...(await bounded(env.GAME.inspect(code))),
              };
            } catch {
              return {
                roomCode: code,
                available: false,
                reason: "backend_unavailable",
              };
            }
          }),
        )),
      );
    }
    return {
      ...monitoring,
      rooms,
      scope: "monitored_rooms_only",
      sampledAt: new Date().toISOString(),
    };
  };
  server.registerTool(
    "get_game_status",
    {
      description:
        "Check the private RULESHIFT backend binding. This is reachability, not a global uptime guarantee.",
      inputSchema: noArgs,
      annotations: readAnnotations,
    },
    () =>
      safely(async () => ({
        ...(await bounded(env.GAME.getStatus())),
        checkedAt: new Date().toISOString(),
        scope: "backend_binding",
      })),
  );
  server.registerTool(
    "get_game_config",
    {
      description:
        "Read an allowlisted projection of actual shared game constants. No environment variables; gameplay config is immutable through MCP.",
      inputSchema: noArgs,
      annotations: readAnnotations,
    },
    () => safely(async () => ({ config: await bounded(env.GAME.getConfig()) })),
  );
  server.registerTool(
    "get_active_matches",
    {
      description:
        "List countdown/playing matches among explicitly monitored rooms. Includes monitoring revision and unavailable rooms; NOT a global match index.",
      inputSchema: noArgs,
      annotations: readAnnotations,
    },
    () =>
      safely(async () => {
        const data = await inspectMonitored();
        return {
          scope: data.scope,
          sampledAt: data.sampledAt,
          revision: data.revision,
          monitoredRooms: data.rooms.map((room) => room.roomCode),
          matches: data.rooms.filter(
            (room) =>
              room.available &&
              ["countdown", "playing"].includes(String(room.phase)),
          ),
          unavailable: data.rooms.filter((room) => !room.available),
        };
      }),
  );
  server.registerTool(
    "get_match_details",
    {
      description:
        "Read a monitored room's redacted authoritative state. matchId is a per-room counter, not a globally unique identifier; expectedMatchId detects rematches.",
      inputSchema: z
        .object({
          roomCode,
          expectedMatchId: z
            .number()
            .int()
            .min(0)
            .max(Number.MAX_SAFE_INTEGER)
            .optional(),
        })
        .strict(),
      annotations: readAnnotations,
    },
    (input) =>
      safely(async () => {
        if (
          !(await bounded(control.monitoring())).rooms.includes(input.roomCode)
        )
          throw new ToolFailure("room_not_monitored");
        const details = await bounded(env.GAME.inspect(input.roomCode));
        if (!details.available) throw new ToolFailure("room_unavailable");
        if (
          input.expectedMatchId !== undefined &&
          input.expectedMatchId !== details.matchId
        )
          throw new ToolFailure("match_changed");
        return { ...details, sampledAt: new Date().toISOString() };
      }),
  );
  server.registerTool(
    "get_server_stats",
    {
      description:
        "Compute current counts from monitored rooms only. No invented historical totals, CPU metrics or global player counts.",
      inputSchema: noArgs,
      annotations: readAnnotations,
    },
    () =>
      safely(async () => {
        const data = await inspectMonitored();
        const available = data.rooms.filter((room) => room.available);
        return {
          scope: data.scope,
          sampledAt: data.sampledAt,
          revision: data.revision,
          monitoredRooms: data.rooms.length,
          availableRooms: available.length,
          unavailableRooms: data.rooms.length - available.length,
          playingMatches: available.filter((room) => room.phase === "playing")
            .length,
          connectedPlayers: available.reduce(
            (total, room) =>
              total + (room.players as { connected: number }).connected,
            0,
          ),
          historicalTotalsAvailable: false,
        };
      }),
  );
  server.registerTool(
    "get_recent_events",
    {
      description:
        "Read the last MCP audit events (bounded retention). These are MCP operations, NOT gameplay event history.",
      inputSchema: z
        .object({ limit: z.number().int().min(1).max(100).default(20) })
        .strict(),
      annotations: readAnnotations,
    },
    (input) =>
      safely(async () => ({
        scope: "mcp_audit_only",
        ...(await bounded(control.recent(input.limit))),
      })),
  );
  if (actor.role === "operator" && env.MCP_WRITES_ENABLED === "true") {
    for (const operation of ["watch_room", "unwatch_room"] as const) {
      server.registerTool(
        operation,
        {
          description:
            operation === "watch_room"
              ? "Add an existing room to MCP monitoring (maximum 20). Requires operator permission, enabled writes and the current expectedRevision. Does not change the match."
              : "Remove a room from MCP monitoring. Does not close, kick or alter the room. Requires the current expectedRevision.",
          inputSchema: monitorSchema,
          annotations: writeAnnotations,
        },
        (input) =>
          safely(async () => {
            if (
              operation === "watch_room" &&
              !(await bounded(env.GAME.inspect(input.roomCode))).available
            )
              throw new ToolFailure("room_unavailable");
            return {
              ...(await bounded(control.change(actor, operation, input))),
              scope: "monitoring_only",
            };
          }),
      );
    }
  }
  return server;
}
