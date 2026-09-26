import Phaser from "phaser";
import { WIDTH, HEIGHT, center } from "../config";
import { Player } from "../player";
import { RuleSystem } from "../rules";
import {
  clearMenu,
  label,
  showMenu,
  showResults,
  notifyAchievements,
  updateChrome,
} from "../ui";
import { UnifiedInput } from "../input";
import { profile, persistProfile, unlockAchievements } from "../profile";
import { Scoring } from "../shared/scoring";
import { t } from "../locales";
import { audio } from "../audio";
import { drawArena } from "../arena";
import { hideHud, showHud } from "../hud";
import { isPortraitTouch, updateOrientation } from "../device";
import { OnlineClient } from "../online/client";
export class ArenaScene extends Phaser.Scene {
  private player?: Player;
  private rules?: RuleSystem;
  private running = false;
  private paused = false;
  private survival = 0;
  private flawless = 0;
  private scoring = new Scoring();
  private controls!: UnifiedInput;
  private online?: OnlineClient;
  private hudClock = 0;
  constructor() {
    super("Arena");
  }
  create(): void {
    this.controls = new UnifiedInput(this);
    updateChrome();
    updateOrientation();
    this.mainMenu();
    const pause = document.querySelector<HTMLElement>("#pause")!;
    const onBlur = () => {
      this.controls.reset();
      if (this.running) this.setPaused(true);
    };
    const onVisibility = () => {
      if (document.hidden) onBlur();
    };
    const onResize = () => {
      updateOrientation();
      if (isPortraitTouch()) onBlur();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && this.running) this.setPaused(!this.paused);
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    document.querySelector<HTMLButtonElement>("#pause-button")!.onclick = () =>
      this.online ? this.online.leave() : this.setPaused(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.online?.dispose();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      pause.hidden = true;
    });
  }
  private resetArena(): void {
    this.controls.reset();
    this.tweens.killAll();
    this.children.removeAll(true);
    drawArena(this);
    hideHud();
    this.player = undefined;
    this.rules = undefined;
  }
  private mainMenu(): void {
    this.running = false;
    this.online?.dispose();
    this.online = undefined;
    this.resetArena();
    document.querySelector<HTMLElement>("#pause-button")!.hidden = true;
    showMenu(
      () => this.startRound(),
      () => {
        clearMenu();
        this.online = new OnlineClient(
          this,
          this.controls,
          () => this.mainMenu(),
          (title, subtitle, color) => this.announcement(title, subtitle, color),
        );
        this.online.showMenu();
      },
    );
  }
  private startRound(): void {
    clearMenu();
    this.resetArena();
    this.paused = false;
    this.running = true;
    this.survival = 0;
    this.flawless = 0;
    this.scoring = new Scoring();
    this.player = new Player(this, this.controls);
    profile.stats.soloGames++;
    notifyAchievements(unlockAchievements(profile));
    persistProfile();
    document.body.classList.add("playing");
    const pauseButton = document.querySelector<HTMLElement>("#pause-button")!;
    pauseButton.hidden = false;
    pauseButton.textContent = "Ⅱ";
    pauseButton.setAttribute("aria-label", t("paused"));
    this.rules = new RuleSystem(
      this,
      this.player,
      (title, subtitle, color) => this.announcement(title, subtitle, color),
      () => this.hit(),
      (count) => {
        const bonus = this.scoring.complete(count);
        audio.play("success");
        const success = label(
          this,
          center.x,
          177,
          `${t("complete")} +${bonus} · ${t("streak")} ×${Math.min(5, this.scoring.streak)}`,
          20,
          "#b9fa6a",
        ).setOrigin(0.5);
        this.tweens.add({
          targets: success,
          y: 161,
          alpha: 0,
          delay: 700,
          duration: 550,
          onComplete: () => success.destroy(),
        });
        profile.stats.rules += count;
        if (count > 1) profile.stats.chaos++;
        profile.stats.streak = Math.max(
          profile.stats.streak,
          this.scoring.bestStreak,
        );
        this.saveProgress();
      },
      () => this.scoring.fail(),
    );
    if (isPortraitTouch()) this.setPaused(true);
  }
  private setPaused(paused: boolean): void {
    if (!this.running) return;
    this.paused = paused;
    this.controls.reset();
    const panel = document.querySelector<HTMLElement>("#pause")!;
    panel.hidden = !paused;
    if (paused) {
      panel.innerHTML = `<strong>${t("paused")}</strong><button id="resume">${t("resume")}</button><button id="end-run" class="secondary">${t("quit")}</button>`;
      panel.querySelector<HTMLButtonElement>("#resume")!.onclick = () => {
        if (!isPortraitTouch()) this.setPaused(false);
      };
      panel.querySelector<HTMLButtonElement>("#end-run")!.onclick = () => {
        panel.hidden = true;
        this.finish();
      };
    }
  }
  private announcement(title: string, subtitle: string, color: number): void {
    audio.play("warning");
    const panel = this.add
      .rectangle(center.x, center.y, 920, 148, 0x080d15, 0.94)
      .setStrokeStyle(1, color, 0.4);
    const heading = label(
      this,
      center.x,
      center.y - 27,
      title,
      title.length > 28 ? 25 : 37,
      `#${color.toString(16).padStart(6, "0")}`,
    ).setOrigin(0.5);
    const sub = label(this, center.x, center.y + 27, subtitle, 18, "#c0cdd4")
      .setOrigin(0.5)
      .setWordWrapWidth(860);
    const group = this.add
      .container(0, 8, [panel, heading, sub])
      .setDepth(30)
      .setAlpha(0);
    this.tweens.add({
      targets: group,
      alpha: 1,
      y: 0,
      duration: 150,
      hold: 1100,
      yoyo: true,
      onComplete: () => group.destroy(),
    });
  }
  private hit(): void {
    if (this.player?.damage()) {
      this.flawless = 0;
      this.scoring.fail();
      audio.play("damage");
    }
  }
  private saveProgress(): void {
    profile.stats.best = Math.max(
      profile.stats.best,
      this.scoring.score(this.survival),
    );
    profile.stats.longest = Math.max(profile.stats.longest, this.survival);
    profile.stats.flawless = Math.max(profile.stats.flawless, this.flawless);
    notifyAchievements(unlockAchievements(profile));
    persistProfile();
  }
  private finish(): void {
    this.running = false;
    this.saveProgress();
    hideHud();
    this.controls.reset();
    document.querySelector<HTMLElement>("#pause-button")!.hidden = true;
    this.add
      .rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x080d15, 0.85)
      .setDepth(50);
    showResults(
      this.scoring.score(this.survival),
      this.survival,
      profile.stats.best,
      () => this.startRound(),
      () => this.mainMenu(),
    );
  }
  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.05);
    if (this.online) {
      this.online.update(dt);
      return;
    }
    if (!this.running || this.paused || !this.player || !this.rules) return;
    const previousSecond = Math.floor(this.survival);
    this.survival += dt;
    this.flawless += dt;
    this.player.update(dt);
    this.rules.update(dt, this.survival);
    this.hudClock -= dt;
    if (this.hudClock <= 0) {
      this.hudClock = 0.1;
      showHud(
        this.player.hp,
        this.scoring.score(this.survival),
        this.survival,
        this.rules.engine.state,
        this.scoring.streak,
      );
    }
    if (
      previousSecond !== Math.floor(this.survival) &&
      Math.floor(this.survival) % 5 === 0
    )
      this.saveProgress();
    if (this.player.hp <= 0) this.finish();
  }
}
