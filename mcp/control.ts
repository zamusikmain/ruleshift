import { DurableObject } from "cloudflare:workers";
import {
  auditSchema,
  monitorSchema,
  principalSchema,
  ToolFailure,
  type AuditInput,
  type AuditEvent,
  type Principal,
  type MonitorInput,
  type Monitoring,
} from "./contracts";

export const AUDIT_RETENTION = 100;
export const MONITOR_LIMIT = 20;
export const REQUESTS_PER_MINUTE = 60;
interface State extends Monitoring {
  sequence: number;
  events: AuditEvent[];
  rates: Record<string, { start: number; count: number }>;
}
const emptyState = (): State => ({
  revision: 0,
  rooms: [],
  sequence: 0,
  events: [],
  rates: {},
});
function append(state: State, event: AuditInput): void {
  state.events.push({
    ...event,
    sequence: ++state.sequence,
    at: new Date().toISOString(),
  });
  state.events = state.events.slice(-AUDIT_RETENTION);
}
export class McpControl extends DurableObject<{ MCP_WRITES_ENABLED?: string }> {
  private async mutate<T>(callback: (state: State) => T): Promise<T> {
    return this.ctx.storage.transaction(async (storage) => {
      const state = (await storage.get<State>("state")) ?? emptyState();
      const result = callback(state);
      await storage.put("state", state);
      return result;
    });
  }
  async monitoring(): Promise<Monitoring> {
    const state = (await this.ctx.storage.get<State>("state")) ?? emptyState();
    return { revision: state.revision, rooms: [...state.rooms] };
  }
  async consumeRate(actor: Principal): Promise<boolean> {
    principalSchema.parse(actor);
    return this.mutate((state) => {
      const now = Date.now();
      for (const [id, rate] of Object.entries(state.rates))
        if (now - rate.start >= 60000) delete state.rates[id];
      const key = `actor:${actor.id}`;
      const rate = state.rates[key] ?? { start: now, count: 0 };
      if (
        rate.count >= REQUESTS_PER_MINUTE ||
        (Object.keys(state.rates).length >= 64 && !state.rates[key])
      )
        return false;
      state.rates[key] = { ...rate, count: rate.count + 1 };
      return true;
    });
  }
  async audit(input: AuditInput): Promise<void> {
    const event = auditSchema.parse(input);
    await this.mutate((state) => append(state, event));
  }
  async recent(
    limit: number,
  ): Promise<{ events: AuditEvent[]; retention: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_RETENTION)
      throw new Error("invalid_limit");
    const state = (await this.ctx.storage.get<State>("state")) ?? emptyState();
    return {
      events: state.events.slice(-limit).reverse(),
      retention: AUDIT_RETENTION,
    };
  }
  async change(
    actor: Principal,
    operation: "watch_room" | "unwatch_room",
    raw: MonitorInput,
  ): Promise<Monitoring> {
    principalSchema.parse(actor);
    const input = monitorSchema.parse(raw);
    if (operation !== "watch_room" && operation !== "unwatch_room")
      throw new Error("invalid_operation");
    const outcome = await this.mutate((state) => {
      const error =
        actor.role !== "operator" || this.env.MCP_WRITES_ENABLED !== "true"
          ? "forbidden"
          : input.expectedRevision !== state.revision
            ? "revision_conflict"
            : operation === "watch_room" &&
                !state.rooms.includes(input.roomCode) &&
                state.rooms.length >= MONITOR_LIMIT
              ? "monitor_limit"
              : null;
      if (error) {
        append(state, {
          actor,
          action: operation,
          outcome: error === "revision_conflict" ? "conflict" : "denied",
        });
        return { error } as const;
      }
      const exists = state.rooms.includes(input.roomCode);
      if (operation === "watch_room" && !exists) {
        state.rooms.push(input.roomCode);
        state.revision++;
      }
      if (operation === "unwatch_room" && exists) {
        state.rooms = state.rooms.filter((code) => code !== input.roomCode);
        state.revision++;
      }
      // Mutation and its audit event commit atomically. Arguments and room invite codes are not logged.
      append(state, { actor, action: operation, outcome: "success" });
      return { value: { revision: state.revision, rooms: [...state.rooms] } };
    });
    if (outcome.error) throw new ToolFailure(outcome.error);
    return outcome.value!;
  }
}
