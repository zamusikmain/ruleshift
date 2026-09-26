import Phaser from "phaser";
import type { UnifiedInput } from "../input";
import { t, type TextKey } from "../locales";
import { profile, persistProfile, unlockAchievements } from "../profile";
import {
  panel,
  button,
  bind,
  escapeHtml,
  colorHex,
  clearMenu,
  notifyAchievements,
  toast,
} from "../ui";
import { validRoomCode } from "../shared/identity";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type {
  ClientMessage,
  RoomSnapshot,
  ServerMessage,
} from "../shared/protocol";
import { RuleView, ruleTitle, ruleSubtitle } from "../ruleView";
import { RULE_DEFS, isFrozen } from "../shared/ruleEngine";
import { createPlayerView } from "../playerView";
import { showHud, hideHud } from "../hud";
import { isPortraitTouch, updateOrientation } from "../device";
import { audio } from "../audio";
import { formatTime } from "../config";
import { FeatureView, showAbilities } from "../featureView";
export class OnlineClient {
  private socket?: WebSocket;
  private code = "";
  private id = "";
  private token = "";
  private snapshot?: RoomSnapshot;
  private inputTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectTimeout?: ReturnType<typeof setTimeout>;
  private intentional = false;
  private reconnectDeadline = 0;
  private lastPacket = 0;
  private lastPing = 0;
  private renderKey = "";
  private serial = -1;
  private view: RuleView;
  private features: FeatureView;
  private wasSuddenDeath = false;
  private players = new Map<string, Phaser.GameObjects.Container>();
  private priorHp = new Map<string, number>();
  private countedMatch = 0;
  private finishedMatch = 0;
  private accountedRules = 0;
  private accountedChaos = 0;
  private lastStatsSecond = -1;
  private hudClock = 0;
  private attempt = 0;
  constructor(
    private scene: Phaser.Scene,
    private controls: UnifiedInput,
    private exit: () => void,
    private announce: (title: string, subtitle: string, color: number) => void,
  ) {
    this.view = new RuleView(scene);
    this.features = new FeatureView(scene);
  }
  showMenu(error?: TextKey): void {
    this.controls.setEnabled(false);
    this.renderKey = "menu";
    this.hidePlayers();
    this.snapshot = undefined;
    hideHud();
    document.body.classList.remove("playing", "online-match");
    document.querySelector<HTMLElement>("#pause-button")!.hidden = true;
    const render = () => this.showMenu(error);
    panel(
      t("online"),
      `<p class="hint">${escapeHtml(profile.name)} · ${t("players")} 2–8</p>${button("create-room", "createRoom")}<p>${t("roomCode")}</p><input id="room-code" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABC234" aria-label="${t("roomCode")}"><p id="online-error" class="error" role="alert">${error ? t(error) : ""}</p>${button("join-room", "joinRoom")}${button("back", "back", true)}`,
      render,
    );
    bind("back", this.exit);
    bind("create-room", () => {
      void this.create();
    });
    bind("join-room", () => {
      const code = document
        .querySelector<HTMLInputElement>("#room-code")!
        .value.trim()
        .toUpperCase();
      if (!validRoomCode(code)) {
        document.querySelector("#online-error")!.textContent = t("invalidCode");
        return;
      }
      void this.join(code);
    });
  }
  private connecting(reconnect = false): void {
    this.controls.setEnabled(false);
    panel(
      t(reconnect ? "reconnecting" : "connecting"),
      `${button("cancel", "back", true)}`,
    );
    bind("cancel", () => this.leave());
  }
  private async create(): Promise<void> {
    const attempt = ++this.attempt;
    this.connecting();
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
      });
      const data = (await response.json()) as {
        code?: string;
        error?: TextKey;
      };
      if (attempt !== this.attempt || this.intentional) return;
      if (!response.ok || !validRoomCode(data.code)) {
        this.showMenu(data.error === "rateLimit" ? "rateLimit" : "unavailable");
        return;
      }
      await this.join(data.code);
    } catch {
      if (attempt === this.attempt && !this.intentional)
        this.showMenu("unavailable");
    }
  }
  private async join(code: string): Promise<void> {
    const attempt = ++this.attempt;
    this.connecting();
    try {
      const response = await fetch(`/api/rooms/${code}`, {
        signal: AbortSignal.timeout(8000),
      });
      const data = (await response.json()) as {
        error?: string;
        phase?: string;
      };
      if (attempt !== this.attempt || this.intentional) return;
      if (!response.ok) {
        this.showMenu(this.errorKey(data.error));
        return;
      }
      this.code = code;
      this.token = "";
      this.id = "";
      this.countedMatch = 0;
      this.finishedMatch = 0;
      this.openSocket();
    } catch {
      if (attempt === this.attempt && !this.intentional)
        this.showMenu("unavailable");
    }
  }
  private errorKey(value: unknown): TextKey {
    return typeof value === "string" &&
      [
        "roomNotFound",
        "roomFull",
        "matchStarted",
        "invalidMessage",
        "rateLimit",
        "roomExpired",
        "connectionLost",
        "matchReset",
        "versionMismatch",
      ].includes(value)
      ? (value as TextKey)
      : "unavailable";
  }
  private openSocket(): void {
    const url = new URL(`/api/rooms/${this.code}`, location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.socket = socket;
    this.intentional = false;
    this.connectTimeout = setTimeout(() => {
      if (!this.id || socket.readyState !== WebSocket.OPEN) socket.close();
    }, 6000);
    socket.onopen = () => {
      this.send({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        name: profile.name,
        color: profile.color,
        ...(this.token ? { token: this.token } : {}),
      });
    };
    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      this.lastPacket = Date.now();
      if (message.type === "welcome") {
        clearTimeout(this.connectTimeout);
        this.id = message.id;
        this.token = message.token;
        this.reconnectDeadline = 0;
        this.renderKey = "";
        clearInterval(this.inputTimer);
        this.inputTimer = setInterval(() => this.sendInput(), 50);
        return;
      }
      if (message.type === "error") {
        clearInterval(this.inputTimer);
        this.socket = undefined;
        socket.close();
        this.hidePlayers();
        this.showMenu(this.errorKey(message.code));
        return;
      }
      if (message.type === "state") this.receive(message);
    };
    socket.onerror = () => {
      /* Close handles retry and localized errors. */
    };
    socket.onclose = () => {
      clearTimeout(this.connectTimeout);
      clearInterval(this.inputTimer);
      this.controls.reset();
      if (this.intentional || this.socket !== socket) return;
      if (!this.token) {
        this.showMenu("connectionLost");
        return;
      }
      this.reconnectDeadline ||= Date.now() + 6000;
      if (Date.now() >= this.reconnectDeadline) {
        this.hidePlayers();
        this.showMenu("connectionLost");
        return;
      }
      this.connecting(true);
      this.reconnectTimer = setTimeout(() => this.openSocket(), 650);
    };
  }
  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(message));
  }
  private sendInput(): void {
    if (Date.now() - this.lastPacket > 10000) {
      this.socket?.close();
      return;
    }
    if (Date.now() - this.lastPing >= 3000) {
      this.send({ type: "ping" });
      this.lastPing = Date.now();
    }
    const me = this.snapshot?.players.find((p) => p.id === this.id);
    if (this.snapshot?.phase !== "playing" || !me || me.hp <= 0) return;
    const input =
      document.hidden || isPortraitTouch()
        ? { x: 0, y: 0 }
        : this.controls.read();
    this.send({ type: "input", ...input });
    if (this.controls.consumeDash()) this.send({ type: "dash" });
    if (this.controls.consumeWave()) this.send({ type: "shockwave" });
  }
  private receive(state: RoomSnapshot): void {
    if (state.protocol !== PROTOCOL_VERSION) {
      this.intentional = true;
      clearInterval(this.inputTimer);
      this.socket?.close();
      this.showMenu("versionMismatch");
      return;
    }
    this.snapshot = state;
    const me = state.players.find((p) => p.id === this.id);
    if (!me) return;
    this.controls.setEnabled(
      state.phase === "playing" &&
        me.hp > 0 &&
        !document.hidden &&
        !isPortraitTouch(),
    );
    if (
      (state.phase === "countdown" || state.phase === "playing") &&
      this.countedMatch !== state.matchId
    ) {
      this.countedMatch = state.matchId;
      this.accountedRules = 0;
      this.accountedChaos = 0;
      this.serial = -1;
      this.priorHp.clear();
      this.features.reset();
      this.wasSuddenDeath = false;
      profile.stats.onlineGames++;
      persistProfile();
    }
    if (state.phase === "playing" || state.phase === "results") {
      profile.stats.rules += Math.max(0, me.rules - this.accountedRules);
      this.accountedRules = me.rules;
      profile.stats.chaos += Math.max(0, me.chaos - this.accountedChaos);
      this.accountedChaos = me.chaos;
      profile.stats.longest = Math.max(
        profile.stats.longest,
        me.eliminatedAt ?? state.time,
      );
      profile.stats.flawless = Math.max(profile.stats.flawless, me.flawless);
      profile.stats.streak = Math.max(profile.stats.streak, me.bestStreak);
      profile.stats.best = Math.max(profile.stats.best, me.score);
      if (state.phase === "results" && this.finishedMatch !== state.matchId) {
        this.finishedMatch = state.matchId;
        if (state.winnerId === this.id) {
          profile.stats.wins++;
          audio.play("victory");
        }
        notifyAchievements(unlockAchievements(profile));
        persistProfile();
      }
      if (this.lastStatsSecond !== Math.floor(state.time)) {
        this.lastStatsSecond = Math.floor(state.time);
        notifyAchievements(unlockAchievements(profile));
        persistProfile();
      }
    }
    if (state.phase === "playing") {
      if (this.renderKey !== "playing") {
        clearMenu();
        this.controls.reset();
        document.body.classList.add("playing", "online-match");
        updateOrientation();
        const leave =
          document.querySelector<HTMLButtonElement>("#pause-button")!;
        leave.hidden = false;
        leave.textContent = "×";
        leave.setAttribute("aria-label", t("leave"));
        this.renderKey = "playing";
      }
      if (state.suddenDeath && !this.wasSuddenDeath) {
        this.wasSuddenDeath = true;
        this.announce(t("suddenDeath"), t("suddenDeathHint"), 0xff647d);
      }
      if (
        state.rules.phase === "announce" &&
        this.serial !== state.rules.serial
      ) {
        this.serial = state.rules.serial;
        const ids = state.rules.ids;
        this.announce(
          state.rules.event ? t("overload") : ruleTitle(state.rules),
          ruleSubtitle(state.rules),
          RULE_DEFS[ids[0]].color,
        );
      }
      return;
    }
    const key = JSON.stringify([
      state.phase,
      Math.ceil(state.countdown),
      state.hostId,
      state.players.map((p) => [p.id, p.connected, p.ready, p.hp]),
      state.winnerId,
    ]);
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.hidePlayers();
    hideHud();
    this.controls.setEnabled(false);
    document.body.classList.remove("online-match");
    document.querySelector<HTMLElement>("#pause-button")!.hidden = true;
    if (state.phase === "countdown") {
      panel(
        t("starting"),
        `<div class="room-code">${Math.ceil(state.countdown)}</div><p>${t("onlineContinues")}</p>${button("leave", "leave", true)}`,
      );
      bind("leave", () => this.leave());
      return;
    }
    if (state.phase === "results") {
      this.results(state);
      return;
    }
    const content = `<div class="room-code">${state.code}</div><p class="hint">${t("roomCode")} · ${t("players")} ${state.players.length}/8</p>${this.roster(state)}<p class="hint">${t("waiting")}</p>${button("ready", me.ready ? "notReady" : "ready")}${state.hostId === this.id ? button("start", "start") : ""}${button("leave", "leave", true)}`;
    panel(t("lobby"), content, () => {
      this.renderKey = "";
      this.receive(state);
    });
    bind("ready", () => this.send({ type: "ready", ready: !me.ready }));
    if (state.hostId === this.id) {
      const start = document.querySelector<HTMLButtonElement>("#start")!;
      start.disabled =
        state.players.length < 2 ||
        !state.players.every((p) => p.ready && p.connected);
      bind("start", () => this.send({ type: "start" }));
    }
    bind("leave", () => this.leave());
  }
  private roster(state: RoomSnapshot, results = false): string {
    const players = results
      ? [...state.players].sort(
          (a, b) =>
            Number(b.id === state.winnerId) - Number(a.id === state.winnerId) ||
            (b.eliminatedAt ?? state.time) - (a.eliminatedAt ?? state.time),
        )
      : state.players;
    return `<ul class="player-list">${players.map((p) => `<li><i class="dot" style="background:${colorHex(p.color)}"></i><span>${escapeHtml(p.name)} ${p.id === this.id ? `(${t("you")})` : ""}</span><span class="player-status ${p.id === state.winnerId ? "winner" : ""}">${results ? `${p.id === state.winnerId ? t("victory") : t("eliminated")} · ${formatTime(p.eliminatedAt ?? state.time)}` : `${p.id === state.hostId ? `${t("host")} · ` : ""}${!p.connected ? t("disconnected") : t(p.ready ? "ready" : "notReady")}`}</span></li>`).join("")}</ul>`;
  }
  private results(state: RoomSnapshot): void {
    const me = state.players.find((p) => p.id === this.id)!;
    const winner = state.players.find((p) => p.id === state.winnerId);
    const highlights = [
      ["perfects", me.perfects],
      ["nearMisses", me.nearMisses],
      ["damageTaken", me.damageTaken],
      ["pickupsCollected", me.pickups],
    ] as const;
    panel(
      t(
        state.winnerId === this.id
          ? "victory"
          : state.winnerId === null
            ? "draw"
            : "results",
      ),
      `${winner ? `<p>${t("winnerName", { name: escapeHtml(winner.name) })}</p>` : ""}<p>${t("placement", { n: me.placement })} · ${formatTime(me.eliminatedAt ?? state.time)}</p><div class="match-highlights">${highlights.map(([key, value]) => `<div>${t(key)}<b>${value}</b></div>`).join("")}</div><div class="result-actions">${state.hostId === this.id ? button("rematch", "rematch") : `<p>${t("host")}: ${t("rematch")}</p>`}${button("leave", "leave", true)}</div>${this.roster(state, true)}`,
      () => this.results(state),
    );
    if (state.hostId === this.id)
      bind("rematch", () => this.send({ type: "rematch" }));
    bind("leave", () => this.leave());
  }
  private hidePlayers(): void {
    this.features.hide();
    this.players.forEach((view) => view.setVisible(false));
    if (this.snapshot)
      this.view.draw({ ...this.snapshot.rules, phase: "rest" });
  }
  update(dt: number): void {
    const state = this.snapshot;
    if (!state || state.phase !== "playing" || this.renderKey !== "playing")
      return;
    this.view.draw(state.rules);
    this.features.draw(
      state.pickups,
      state.players,
      this.id,
      dt,
      state.arenaInset,
    );
    for (const p of state.players) {
      let view = this.players.get(p.id);
      if (!view) {
        view = createPlayerView(this.scene, p.x, p.y, p.color, p.name);
        this.players.set(p.id, view);
      }
      view.setVisible(p.hp > 0);
      view.x += (p.x - view.x) * (1 - Math.exp(-22 * dt));
      view.y += (p.y - view.y) * (1 - Math.exp(-22 * dt));
      view.alpha =
        p.invulnerable > 0 && Math.floor(p.invulnerable * 15) % 2 ? 0.3 : 1;
      if ((this.priorHp.get(p.id) ?? 3) > p.hp) {
        if (p.id === this.id) {
          audio.play("damage");
          this.scene.cameras.main.shake(140, 0.003);
          if (p.hp === 0) {
            this.controls.setEnabled(false);
            toast(t("spectator"));
          }
        }
        if (p.hp === 0) {
          const burst = this.scene.add.circle(p.x, p.y, 20, 0xff647d, 0.6);
          this.scene.tweens.add({
            targets: burst,
            scale: 3,
            alpha: 0,
            duration: 500,
            onComplete: () => burst.destroy(),
          });
        }
      }
      this.priorHp.set(p.id, p.hp);
    }
    const me = state.players.find((p) => p.id === this.id);
    this.hudClock -= dt;
    if (me && this.hudClock <= 0) {
      this.hudClock = 0.1;
      showAbilities(me, isFrozen(state.rules));
      showHud(
        me.hp,
        me.score,
        state.time,
        state.rules,
        me.streak,
        state.players.filter((p) => p.hp > 0).length,
      );
    }
  }
  leave(): void {
    this.send({ type: "leave" });
    this.dispose();
    this.exit();
  }
  dispose(): void {
    this.intentional = true;
    this.attempt++;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectTimeout);
    clearInterval(this.inputTimer);
    this.socket?.close();
    this.socket = undefined;
    this.controls.setEnabled(false);
    this.hidePlayers();
    this.features.destroy();
    this.players.forEach((view) => view.destroy());
    this.players.clear();
    document.body.classList.remove("playing", "online-match");
    hideHud();
  }
}
