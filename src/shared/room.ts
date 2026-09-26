import { createBody, moveBody, damageBody, type Movement } from "./movement";
import { RuleEngine, type RandomSource } from "./ruleEngine";
import { Scoring } from "./scoring";
import { PALETTE } from "./identity";
import type {
  ClientMessage,
  ErrorCode,
  PlayerSnapshot,
  RoomSnapshot,
} from "./protocol";
interface Member {
  state: PlayerSnapshot;
  token: string;
  input: Movement;
  lastInput: number;
  disconnectedAt: number | null;
  scoring: Scoring;
  flawless: number;
}
export const RECONNECT_GRACE = 8;
export const ROOM_IDLE_SECONDS = 15 * 60;
export class Room {
  readonly members = new Map<string, Member>();
  phase: RoomSnapshot["phase"] = "lobby";
  hostId = "";
  matchId = 0;
  time = 0;
  countdown = 0;
  winnerId: string | null = null;
  clock = 0;
  lastActivity = 0;
  rules: RuleEngine;
  constructor(
    readonly code: string,
    private random?: RandomSource,
  ) {
    this.rules = new RuleEngine(random);
  }
  join(
    id: string,
    token: string,
    name: string,
    color: number,
    reconnectToken?: string,
  ): { id: string; token: string } | ErrorCode {
    if (reconnectToken) {
      const member = [...this.members.values()].find(
        (m) => m.token === reconnectToken,
      );
      if (
        !member ||
        member.state.connected ||
        member.disconnectedAt === null ||
        this.clock - member.disconnectedAt >= RECONNECT_GRACE
      )
        return "connectionLost";
      member.state.connected = true;
      member.disconnectedAt = null;
      member.lastInput = this.clock;
      this.lastActivity = this.clock;
      return { id: member.state.id, token: member.token };
    }
    if (this.phase === "countdown" || this.phase === "playing")
      return "matchStarted";
    if (this.phase === "results") return "matchStarted";
    if (this.members.size >= 8) return "roomFull";
    const taken = new Set([...this.members.values()].map((m) => m.state.color));
    if (taken.has(color)) color = PALETTE.findIndex((_, i) => !taken.has(i));
    const state: PlayerSnapshot = {
      ...createBody(),
      id,
      name,
      color,
      ready: false,
      connected: true,
      eliminatedAt: null,
      score: 0,
      rules: 0,
      chaos: 0,
      streak: 0,
      bestStreak: 0,
      flawless: 0,
    };
    this.members.set(id, {
      state,
      token,
      input: { x: 0, y: 0 },
      lastInput: this.clock,
      disconnectedAt: null,
      scoring: new Scoring(),
      flawless: 0,
    });
    if (!this.hostId) this.hostId = id;
    this.lastActivity = this.clock;
    return { id, token };
  }
  command(
    id: string,
    message: Exclude<ClientMessage, { type: "hello" }>,
  ): boolean {
    const member = this.members.get(id);
    if (!member || !member.state.connected) return false;
    if (message.type === "ping") return true;
    if (message.type === "input") {
      if (this.phase !== "playing" || member.state.hp <= 0) return false;
      member.input = { x: message.x, y: message.y };
      member.lastInput = this.clock;
      return true;
    }
    this.lastActivity = this.clock;
    if (message.type === "leave") {
      this.remove(id);
      return true;
    }
    if (message.type === "ready" && this.phase === "lobby") {
      member.state.ready = message.ready;
      return true;
    }
    if (
      message.type === "start" &&
      id === this.hostId &&
      this.phase === "lobby" &&
      this.members.size >= 2 &&
      [...this.members.values()].every(
        (m) => m.state.connected && m.state.ready,
      )
    ) {
      this.phase = "countdown";
      this.countdown = 3;
      this.time = 0;
      this.winnerId = null;
      this.matchId++;
      this.rules = new RuleEngine(this.random);
      let index = 0;
      for (const m of this.members.values()) {
        const angle = (index++ / this.members.size) * Math.PI * 2;
        Object.assign(
          m.state,
          createBody(580 + Math.cos(angle) * 130, 399 + Math.sin(angle) * 100),
          {
            eliminatedAt: null,
            score: 0,
            rules: 0,
            chaos: 0,
            streak: 0,
            bestStreak: 0,
            flawless: 0,
          },
        );
        m.scoring = new Scoring();
        m.flawless = 0;
        m.input = { x: 0, y: 0 };
      }
      return true;
    }
    if (
      message.type === "rematch" &&
      id === this.hostId &&
      this.phase === "results"
    ) {
      this.phase = "lobby";
      this.winnerId = null;
      this.time = 0;
      for (const [key, m] of this.members) {
        if (!m.state.connected) this.members.delete(key);
        else {
          m.state.ready = false;
          m.input = { x: 0, y: 0 };
        }
      }
      return true;
    }
    return false;
  }
  disconnect(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    m.state.connected = false;
    m.disconnectedAt = this.clock;
    m.input = { x: 0, y: 0 };
    m.state.ready = false;
  }
  remove(id: string, settle = true): void {
    const m = this.members.get(id);
    if (m && (this.phase === "playing" || this.phase === "countdown")) {
      m.state.hp = 0;
      m.state.eliminatedAt ??= this.time;
      m.state.connected = false;
      m.disconnectedAt = null;
      m.input = { x: 0, y: 0 };
    } else this.members.delete(id);
    if (this.hostId === id)
      this.hostId =
        [...this.members.values()].find((p) => p.state.connected)?.state.id ??
        "";
    if (settle && this.phase === "playing") this.checkWinner();
    if (
      this.phase === "countdown" &&
      [...this.members.values()].filter((p) => p.state.connected).length < 2
    ) {
      this.phase = "lobby";
      for (const [key, p] of this.members) {
        if (!p.state.connected) this.members.delete(key);
        else p.state.ready = false;
      }
    }
  }
  tick(dt: number): void {
    this.clock += dt;
    for (const [id, m] of this.members)
      if (
        m.disconnectedAt !== null &&
        this.clock - m.disconnectedAt >= RECONNECT_GRACE
      )
        this.remove(id, false);
    if (this.phase === "playing") this.checkWinner();
    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = "playing";
      }
      return;
    }
    if (this.phase !== "playing") return;
    this.time += dt;
    this.lastActivity = this.clock;
    for (const m of this.members.values())
      if (m.state.hp > 0) {
        moveBody(
          m.state,
          this.clock - m.lastInput <= 0.3 && m.state.connected
            ? m.input
            : { x: 0, y: 0 },
          dt,
        );
        m.flawless += dt;
        m.state.flawless = Math.max(m.state.flawless, m.flawless);
      }
    this.rules.update(
      dt,
      this.time,
      [...this.members.values()].map((m) => m.state),
      (id) => {
        const m = this.members.get(id)!;
        if (damageBody(m.state)) {
          m.flawless = 0;
          m.scoring.fail();
          if (m.state.hp === 0) m.state.eliminatedAt = this.time;
        }
      },
      (id, count) => this.members.get(id)!.scoring.complete(count),
      (id) => this.members.get(id)!.scoring.fail(),
    );
    for (const m of this.members.values())
      Object.assign(m.state, {
        score: m.scoring.score(m.state.eliminatedAt ?? this.time),
        streak: m.scoring.streak,
        bestStreak: m.scoring.bestStreak,
        rules: m.scoring.rules,
        chaos: m.scoring.chaos,
      });
    this.checkWinner();
    // A finite match prevents abandoned rooms from running indefinitely.
    if (this.time >= 600 && this.phase === "playing") {
      this.phase = "results";
      this.winnerId = null;
    }
  }
  private checkWinner(): void {
    const alive = [...this.members.values()].filter((m) => m.state.hp > 0);
    if (alive.length <= 1) {
      this.phase = "results";
      this.winnerId = alive[0]?.state.id ?? null;
      this.rules.state.hazards = [];
    }
  }
  get expired(): boolean {
    return this.clock - this.lastActivity >= ROOM_IDLE_SECONDS;
  }
  snapshot(): RoomSnapshot {
    return {
      type: "state",
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      matchId: this.matchId,
      players: [...this.members.values()].map((m) => ({ ...m.state })),
      time: this.time,
      countdown: this.countdown,
      winnerId: this.winnerId,
      rules: this.rules.state,
    };
  }
}
