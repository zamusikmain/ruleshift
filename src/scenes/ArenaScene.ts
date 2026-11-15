import Phaser from "phaser";
import { WIDTH, HEIGHT, center, formatTime } from "../config";
import { Player } from "../player";
import { RuleSystem } from "../rules";
import {
  clearMenu,
  label,
  showMenu,
  showResults,
  notifyAchievements,
  updateChrome,
  showOfflineResults,
  notifyProgress,
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
import { PickupSystem } from "../shared/pickups";
import { FeatureView, showAbilities } from "../featureView";
import { pulseThreats } from "../shared/pulse";
import { isFrozen } from "../shared/ruleEngine";
import type { OfflineMode, OnlineMode } from "../shared/modes";
import { dailySpec,DAILY_SECONDS,seededRandom,recordDaily,recordSurvival,offlineFinished } from "../shared/offlineProgress";
import { recordOffline } from "../shared/progression";
export class ArenaScene extends Phaser.Scene {
  private pickups = new PickupSystem();
  private features?: FeatureView;
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
  private mode: OfflineMode = "classic";
  private daily?: ReturnType<typeof dailySpec>;
  private dailyClock=0;
  private runKey="";
  private survivedEvents=0;
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
      if (this.requiresLandscape()) onBlur();
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
    this.controls.setEnabled(false);
    this.features?.destroy();
    this.features = undefined;
    this.tweens.killAll();
    this.children.removeAll(true);
    drawArena(this);
    hideHud();
    this.player = undefined;
    this.rules = undefined;
  }
  private mainMenu(): void {
    this.running = false;
    document.body.classList.remove("portrait-offline");
    this.online?.dispose();
    this.online = undefined;
    this.resetArena();
    document.querySelector<HTMLElement>("#pause-button")!.hidden = true;
    showMenu(
      (mode: OfflineMode) => this.startRound(mode),
      (mode: OnlineMode) => {
        clearMenu();
        this.online = new OnlineClient(
          this,
          this.controls,
          () => this.mainMenu(),
          (title, subtitle, color) => this.announcement(title, subtitle, color),
        );
        this.online.showMenu(undefined, mode);
      },
    );
  }
  private startRound(mode: OfflineMode = "classic"): void {
    this.mode = mode;
    this.runKey=crypto.randomUUID();
    this.daily=mode==="daily"?dailySpec():undefined;
    this.dailyClock=0;
    this.survivedEvents=0;
    clearMenu();
    this.resetArena();
    this.paused = false;
    this.running = true;
    this.survival = 0;
    this.flawless = 0;
    this.scoring = new Scoring();
    this.player = new Player(this, this.controls);
    this.pickups = new PickupSystem();
    this.features = new FeatureView(this);
    this.controls.setEnabled(true);
    profile.stats.soloGames++;
    notifyAchievements(unlockAchievements(profile));
    persistProfile();
    document.body.classList.add("playing");
    document.body.classList.toggle("portrait-offline",mode==="survival"||mode==="daily");
    updateOrientation();
    // The document-scrolling dashboard has a different parent height than the arena.
    this.scale?.getParentBounds();
    this.scale?.refresh();
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
        if (this.rules?.engine.state.event) this.scoring.bonus += 300;
        const success = label(
          this,
          center.x,
          177,
          `${t("perfect")} +${bonus} · ${t("streak")} ×${Math.min(5, this.scoring.streak)}`,
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
      () => this.scoring.nearMiss(),
      mode,
      this.daily?seededRandom(this.daily.seed):undefined,
    );
    if (this.requiresLandscape()) this.setPaused(true);
  }
  private requiresLandscape(): boolean {
    return isPortraitTouch() && this.mode!=="survival" && this.mode!=="daily";
  }
  private setPaused(paused: boolean): void {
    if (!this.running) return;
    this.paused = paused;
    this.controls.setEnabled(!paused);
    const panel = document.querySelector<HTMLElement>("#pause")!;
    panel.hidden = !paused;
    if (paused) {
      panel.innerHTML = `<strong>${t("paused")}</strong><button id="resume">${t("resume")}</button><button id="end-run" class="secondary">${t("quit")}</button>`;
      panel.querySelector<HTMLButtonElement>("#resume")!.onclick = () => {
        if (!this.requiresLandscape()) this.setPaused(false);
      };
      panel.querySelector<HTMLButtonElement>("#end-run")!.onclick = () => {
        panel.hidden = true;
        this.finish("quit");
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
  private hit(): boolean {
    if (this.player?.damage()) {
      this.flawless = 0;
      this.scoring.fail();
      audio.play("damage");
      return true;
    }
    return false;
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
  private finish(reason:"normal"|"quit"="normal"): void {
    if(!this.running) return;
    this.running = false;
    this.saveProgress();
    hideHud();
    this.controls.setEnabled(false);
    this.features?.hide();
    document.querySelector<HTMLElement>("#pause-button")!.hidden = true;
    this.add
      .rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x080d15, 0.85)
      .setDepth(50);
    const result={time:this.survival,score:this.scoring.score(this.survival),events:this.survivedEvents};
    const notice=recordOffline(profile.progression,this.runKey,this.mode,{...result,perfects:this.scoring.perfects,combos:this.scoring.chaos,damage:this.player?.state.damageTaken??0},reason!=="quit",this.mode==="daily"&&this.survival>=DAILY_SECONDS&&(this.player?.hp??0)>0,this.daily?.date);
    if(this.mode==="survival"||this.mode==="daily") {
      const completed=this.mode==="daily"&&this.survival>=DAILY_SECONDS&&(this.player?.hp??0)>0;
      if(this.mode==="survival") recordSurvival(profile.offline,result);
      const rewarded=this.daily?recordDaily(profile.offline,this.daily,result,completed):false;
      persistProfile();
      notifyProgress(notice,unlockAchievements(profile));
      persistProfile();
      showOfflineResults(this.mode,result,this.daily,completed,rewarded,()=>this.startRound(this.mode),()=>this.mainMenu());
      return;
    }
    notifyProgress(notice,unlockAchievements(profile));
    persistProfile();
    showResults(
      this.scoring.score(this.survival),
      this.survival,
      profile.stats.best,
      () => this.startRound(this.mode),
      () => this.mainMenu(),
    );
  }
  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.05);
    if (this.online) {
      this.online.update(dt);
      return;
    }
    if(this.mode==="daily") {
      if(!this.running||this.paused) return;
      this.dailyClock+=dt;
      while(this.dailyClock>=1/60&&this.running&&!this.paused) {this.dailyClock-=1/60;this.step(1/60);}
    } else this.step(dt);
  }
  private step(dt:number):void {
    if (!this.running || this.paused || !this.player || !this.rules) return;
    const previousSecond = Math.floor(this.survival);
    const nextTime=this.survival+dt;
    // Fixed-step floating-point accumulation must finish on tick 5400, not 5401.
    this.survival = this.mode==="daily"&&nextTime>=DAILY_SECONDS-1e-7?DAILY_SECONDS:nextTime;
    this.flawless += dt;
    this.player.update(dt, isFrozen(this.rules.engine.state),this.rules.engine.state.overdriveLayers??this.rules.engine.state.overdrive,this.rules.engine.state.elapsed,()=>pulseThreats(this.rules!.engine.state,{...this.player!.state,id:"solo"}));
    if(this.mode!=="daily") this.pickups.update(dt, [this.player.state], this.rules.engine.state);
    this.scoring.tick(dt, this.player.state.scoreTime > 0);
    const phase=this.rules.engine.state.phase;
    this.rules.update(dt, this.survival);
    if(phase==="active"&&this.rules.engine.state.phase==="rest"&&this.rules.engine.state.ids.length>0&&this.player.hp>0) this.survivedEvents++;
    this.features?.draw(
      this.pickups.items,
      [
        {
          ...this.player.state,
          id: "solo",
          perfects: this.scoring.perfects,
          nearMisses: this.scoring.nearMisses,
        },
      ],
      "solo",
      dt,
    );
    this.hudClock -= dt;
    if (this.hudClock <= 0) {
      this.hudClock = 0.1;
      showAbilities(this.player.state, isFrozen(this.rules.engine.state));
      showHud(
        this.player.hp,
        this.scoring.score(this.survival),
        this.survival,
        this.rules.engine.state,
        this.scoring.streak,
        undefined,
        this.mode==="daily"?`${t("dailyProgress")} ${Math.min(DAILY_SECONDS,Math.floor(this.survival))}/${DAILY_SECONDS}`:this.mode==="survival"?`${t("survival")} · ${t("offlineEvents")} ${this.survivedEvents}`:this.mode==="blitz"?`${t("blitz")} · ${formatTime(Math.max(0,Math.ceil(90-this.survival)))}`:undefined,
      );
    }
    if (
      previousSecond !== Math.floor(this.survival) &&
      Math.floor(this.survival) % 5 === 0
    )
      this.saveProgress();
    if (offlineFinished(this.mode,this.survival,this.player.hp)) this.finish();
  }
}
