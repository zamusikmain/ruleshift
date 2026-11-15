import { applyOverdriveMotion } from "./overdriveHazards";
import { pulseThreats } from "./pulse";
import {
  createBody,
  moveBody,
  damageBody,
  activateDash,
  activateShockwave,
  type Movement,
} from "./movement";
import { RuleEngine, isFrozen, type RandomSource } from "./ruleEngine";
import { Scoring } from "./scoring";
import { PALETTE } from "./identity";
import { PROTOCOL_VERSION } from "./protocol";
import type {
  ClientMessage,
  ErrorCode,
  PlayerSnapshot,
  RoomSnapshot,
} from "./protocol";
import { PickupSystem } from "./pickups";
import { SUDDEN_DEATH_START, suddenDeathInset } from "./variants";
import { ARENA } from "../config";
import { type OnlineMode } from "./modes";
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
  mode: OnlineMode = "classic";
  time = 0;
  countdown = 0;
  winnerId: string | null = null;
  clock = 0;
  lastActivity = 0;
  rules: RuleEngine;
  pickups: PickupSystem;
  get suddenDeath(): boolean {
    return this.time >= (this.mode === "lastOneStanding" ? 60 : SUDDEN_DEATH_START);
  }
  get arenaInset(): number {
    return suddenDeathInset(this.time);
  }
  constructor(
    readonly code: string,
    private random?: RandomSource,
  ) {
    this.rules = new RuleEngine(random);
    this.pickups = new PickupSystem(true, random);
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
      perfects: 0,
      nearMisses: 0,
      placement: 0,
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
    if (message.type === "dash") {
      if (this.phase !== "playing" || this.clock - member.lastInput > 0.3)
        return false;
      return activateDash(
        member.state,
        member.input,
        isFrozen(this.rules.state),
      );
    }
    if (message.type === "shockwave") {
      if (this.phase !== "playing") return false;
      const activated = activateShockwave(
        member.state,
        [...this.members.values()].map((m) => m.state),
      );
      if (activated) pulseThreats(this.rules.state, member.state);
      return activated;
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
    if (message.type === "mode" && this.phase === "lobby" && id === this.hostId) {
      this.mode = message.mode;
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
      this.rules = new RuleEngine(this.random, this.mode);
      this.pickups = new PickupSystem(true, this.random);
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
            perfects: 0,
            nearMisses: 0,
            placement: 0,
            forfeited: false,
            eventsSurvived: 0,
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
      m.state.forfeited = true;
      m.state.score = m.scoring.score(m.state.eliminatedAt ?? this.time);
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
        const beforeMovement={x:m.state.x,y:m.state.y};
        if (
          isFrozen(this.rules.state) &&
          Math.hypot(m.input.x, m.input.y) < 0.1
        ) {
          m.state.vx = m.state.vy = 0;
          m.state.dashTime = 0;
        }
        moveBody(
          m.state,
          this.clock - m.lastInput <= 0.3 && m.state.connected
            ? m.input
            : { x: 0, y: 0 },
          dt,
        );
        applyOverdriveMotion(this.rules.state.overdriveLayers??this.rules.state.overdrive,m.state,this.rules.state.elapsed+dt,dt,beforeMovement);
        m.flawless += dt;
        m.state.flawless = Math.max(m.state.flawless, m.flawless);
      }
    this.pickups.update(
      dt,
      [...this.members.values()].map((m) => m.state),
      this.rules.state,
      !this.suddenDeath,
      this.arenaInset,
    );
    const inset = this.arenaInset;
    for (const m of this.members.values()) {
      if (
        m.state.hp > 0 &&
        inset > 0 &&
        (m.state.x - m.state.radius < ARENA.left + inset ||
          m.state.x + m.state.radius > ARENA.right - inset ||
          m.state.y - m.state.radius < ARENA.top + inset * 0.6 ||
          m.state.y + m.state.radius > ARENA.bottom - inset * 0.6)
      ) {
        if (damageBody(m.state)) {
          m.flawless = 0;
          m.scoring.fail();
          if (m.state.hp === 0) m.state.eliminatedAt = this.time;
        }
      }
    }
    const previousPhase=this.rules.state.phase;
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
          return true;
        }
        return false;
      },
      (id, count) => {
        const scoring = this.members.get(id)!.scoring;
        scoring.complete(count);
        if (this.rules.state.event) scoring.bonus += 300;
      },
      (id) => this.members.get(id)!.scoring.fail(),
      (id) => {
        const m = this.members.get(id)!;
        if (m.state.connected && this.clock - m.lastInput <= .3 && Math.hypot(m.input.x,m.input.y) >= .25) m.scoring.nearMiss();
      },
      this.suddenDeath
        ? 1 + Math.min(0.35, (this.time - SUDDEN_DEATH_START) / 180)
        : 1,
      this.arenaInset,
    );
    if(previousPhase==="active"&&this.rules.state.phase==="rest"&&this.rules.state.ids.length>0)
      for(const m of this.members.values()) if(m.state.hp>0) m.state.eventsSurvived=(m.state.eventsSurvived??0)+1;
    for (const m of this.members.values())
      Object.assign(m.state, {
        score: m.scoring.score(m.state.eliminatedAt ?? this.time),
        streak: m.scoring.streak,
        bestStreak: m.scoring.bestStreak,
        rules: m.scoring.rules,
        chaos: m.scoring.chaos,
        perfects: m.scoring.perfects,
        nearMisses: m.scoring.nearMisses,
      });
    this.checkWinner();
    // Blitz is a scored race; other modes retain the existing finite safety cap.
    if (this.time >= (this.mode === "blitz" ? 90 : 600) && this.phase === "playing") {
      this.phase = "results";
      this.rules.state.hazards = [];
      this.rules.state.laserLayout = undefined;
      this.rules.state.burstLayout = undefined;
      this.rules.state.swarmTiles = undefined;
      this.rules.state.crossfire = undefined;
      this.rules.state.collapse = undefined;
      this.rules.state.overdrive = undefined; this.rules.state.overdriveLayers=undefined; this.rules.state.intensity=0; this.rules.state.intensityRemaining=0;
      this.rules.state.comboSafe = undefined;
      if (this.mode === "blitz") {
        const leaders = [...this.members.values()]
          .filter((m) => m.state.connected)
          .sort((a, b) => b.state.score - a.state.score);
        this.winnerId = leaders.length > 1 && leaders[0].state.score === leaders[1].state.score
          ? null
          : (leaders[0]?.state.id ?? null);
      } else this.winnerId = null;
      this.finalizePlacements();
    }
  }
  private checkWinner(): void {
    // A scored Blitz continues to its timer even after combat elimination.
    // Explicit forfeits still allow the last participating player to finish.
    if (this.mode === "blitz" && [...this.members.values()].filter(m => !m.state.forfeited).length >= 2) return;
    const alive = [...this.members.values()].filter((m) => m.state.hp > 0);
    if (alive.length <= 1) {
      this.phase = "results";
      this.winnerId = alive[0]?.state.id ?? null;
      this.rules.state.hazards = [];
      this.rules.state.laserLayout = undefined;
      this.rules.state.burstLayout = undefined;
      this.rules.state.swarmTiles = undefined;
      this.rules.state.crossfire = undefined;
      this.rules.state.collapse = undefined;
      this.rules.state.overdrive = undefined; this.rules.state.overdriveLayers=undefined; this.rules.state.intensity=0; this.rules.state.intensityRemaining=0;
      this.rules.state.comboSafe = undefined;
      this.finalizePlacements();
    }
  }
  private finalizePlacements(): void {
    const players = [...this.members.values()].map((m) => m.state);
    if (this.mode === "blitz") {
      for (const p of players) p.placement = p.forfeited ? players.length :
        1 + players.filter(other => !other.forfeited && other.score > p.score).length;
      return;
    }
    for (const p of players)
      p.placement =
        1 +
        players.filter(
          (other) =>
            (other.eliminatedAt ?? Infinity) > (p.eliminatedAt ?? Infinity),
        ).length;
  }
  get expired(): boolean {
    return this.clock - this.lastActivity >= ROOM_IDLE_SECONDS;
  }
  snapshot(): RoomSnapshot {
    return {
      type: "state",
      protocol: PROTOCOL_VERSION,
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      matchId: this.matchId,
      mode: this.mode,
      players: [...this.members.values()].map((m) => ({ ...m.state })),
      time: this.time,
      countdown: this.countdown,
      winnerId: this.winnerId,
      rules: this.rules.state,
      pickups: this.pickups.items.map((item) => ({ ...item })),
      suddenDeath: this.suddenDeath,
      arenaInset: this.arenaInset,
    };
  }
}
