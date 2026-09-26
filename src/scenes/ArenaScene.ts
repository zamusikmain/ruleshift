import Phaser from 'phaser';
import { ARENA, C, WIDTH, HEIGHT, center, formatTime } from '../config';
import { Player } from '../player';
import { RuleSystem, RULES } from '../rules';
import { clearMenu, label, showMenu, showResults } from '../ui';
import { saveBest } from '../storage';
export class ArenaScene extends Phaser.Scene {
  private player?: Player;
  private rules?: RuleSystem;
  private running = false;
  private paused = false;
  private survival = 0;
  private bonus = 0;
  private hud?: { hp: Phaser.GameObjects.Text; score: Phaser.GameObjects.Text; time: Phaser.GameObjects.Text; rule: Phaser.GameObjects.Text; status: Phaser.GameObjects.Text; difficulty: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics };
  constructor() { super('Arena'); }
  create(): void {
    this.running = false; this.paused = false; this.survival = 0; this.bonus = 0; this.player = undefined; this.rules = undefined; this.hud = undefined;
    this.drawArena();
    showMenu(() => this.startRound());
    const pause = document.querySelector<HTMLDivElement>('#pause')!;
    pause.hidden = true;
    const onBlur = () => { if (this.running) { this.paused = true; this.input.keyboard!.resetKeys(); pause.hidden = false; } };
    const onVisibility = () => { if (document.hidden) onBlur(); };
    const resume = () => { this.paused = false; pause.hidden = true; this.input.keyboard!.resetKeys(); };
    window.addEventListener('blur', onBlur); document.addEventListener('visibilitychange', onVisibility); pause.addEventListener('click', resume);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', onVisibility); pause.removeEventListener('click', resume); });
  }
  private drawArena(): void {
    const g = this.add.graphics();
    g.fillStyle(0x0b131e).fillRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle(0x0d1923).fillRoundedRect(ARENA.left, ARENA.top, ARENA.right - ARENA.left, ARENA.bottom - ARENA.top, 8);
    g.lineStyle(1, 0x1d303c, .5);
    for (let x = ARENA.left + 26; x < ARENA.right; x += 32) g.lineBetween(x, ARENA.top, x, ARENA.bottom);
    for (let y = ARENA.top + 30; y < ARENA.bottom; y += 32) g.lineBetween(ARENA.left, y, ARENA.right, y);
    g.lineStyle(1, 0x314853).strokeRoundedRect(ARENA.left, ARENA.top, ARENA.right - ARENA.left, ARENA.bottom - ARENA.top, 8);
    for (const [x, y, sx, sy] of [[ARENA.left, ARENA.top, 1, 1], [ARENA.right, ARENA.top, -1, 1], [ARENA.left, ARENA.bottom, 1, -1], [ARENA.right, ARENA.bottom, -1, -1]]) {
      g.lineStyle(3, C.lime, .65).lineBetween(x, y + sy * 20, x, y).lineBetween(x, y, x + sx * 20, y);
    }
    g.lineStyle(1, 0x34505b, .5).strokeCircle(center.x, center.y, 54).lineBetween(center.x - 12, center.y, center.x + 12, center.y).lineBetween(center.x, center.y - 12, center.x, center.y + 12);
    label(this, 46, 682, 'RULESHIFT / SURVIVAL CHAMBER', 10, '#5d7888');
    label(this, 1114, 682, 'WASD / ARROW KEYS', 10, '#5d7888').setOrigin(1, 0);
    label(this, 46, 40, 'SYSTEM ONLINE', 11, '#789484');
    label(this, 1114, 40, 'ARENA 001', 11, '#789484').setOrigin(1, 0);
  }
  private startRound(): void {
    clearMenu(); this.tweens.killAll(); this.children.removeAll(true); this.drawArena();
    this.player = new Player(this); this.running = true; this.survival = 0; this.bonus = 0;
    this.rules = new RuleSystem(this, this.player, (title, subtitle, color) => this.announcement(title, subtitle, color), () => this.hit(), () => {
      this.bonus += 100;
      const success = label(this, center.x, 180, 'RULE COMPLETE  +100', 16, '#b9fa6a').setOrigin(.5);
      this.tweens.add({ targets: success, y: 164, alpha: 0, delay: 700, duration: 550, onComplete: () => success.destroy() });
    });
    label(this, 46, 70, 'INTEGRITY', 10, '#77909f');
    label(this, 870, 70, 'SCORE', 10, '#77909f'); label(this, 1028, 70, 'TIME', 10, '#77909f');
    this.hud = {
      hp: label(this, 46, 90, '♥ ♥ ♥', 24, '#b9fa6a'),
      score: label(this, 870, 90, '0000', 26), time: label(this, 1028, 90, '00:00', 26),
      rule: label(this, 580, 65, 'GET READY', 23, '#b9fa6a').setOrigin(.5, 0),
      status: label(this, 580, 99, '', 11, '#92a8b6').setOrigin(.5, 0),
      difficulty: label(this, 580, 40, 'EASY', 10, '#77909f').setOrigin(.5, 0), bar: this.add.graphics().setDepth(20),
    };
  }
  private announcement(title: string, subtitle: string, color: number): void {
    const panel = this.add.rectangle(center.x, center.y, 760, 148, 0x080d15, .94).setStrokeStyle(1, color, .4);
    const heading = label(this, center.x, center.y - 30, title, 43, `#${color.toString(16).padStart(6, '0')}`).setOrigin(.5);
    const sub = label(this, center.x, center.y + 26, subtitle, 14, '#c0cdd4').setOrigin(.5);
    const group = this.add.container(0, 8, [panel, heading, sub]).setDepth(30).setAlpha(0);
    this.tweens.add({ targets: group, alpha: 1, y: 0, duration: 150, hold: 1100, yoyo: true, onComplete: () => group.destroy() });
  }
  private hit(): void {
    if (!this.player?.damage()) return;
    if (this.player.hp <= 0) this.running = false;
  }
  update(_time: number, delta: number): void {
    if (!this.running || this.paused || !this.player || !this.rules || !this.hud) return;
    const dt = Math.min(delta / 1000, .05);
    this.survival += dt; this.player.update(dt); this.rules.update(dt, this.survival);
    const h = this.hud;
    h.hp.setText('♥ '.repeat(this.player.hp) + '♡ '.repeat(3 - this.player.hp)).setColor(this.player.hp === 1 ? '#ff647d' : '#b9fa6a');
    h.score.setText(this.score.toString().padStart(4, '0')); h.time.setText(formatTime(this.survival));
    const color = this.rules.phase === 'rest' ? C.lime : RULES[this.rules.index].color;
    h.rule.setText(this.rules.phase === 'rest' ? 'RECOVER & RESET' : RULES[this.rules.index].name).setColor(`#${color.toString(16)}`);
    h.status.setText(this.rules.status);
    h.difficulty.setText(this.survival >= 60 ? 'HARD / 03' : this.survival >= 30 ? 'NORMAL / 02' : 'EASY / 01');
    h.bar.clear().fillStyle(0x243541).fillRect(370, 126, 420, 3).fillStyle(color).fillRect(370, 126, 420 * this.rules.progress, 3);
    if (this.player.hp <= 0) {
      this.running = false;
      const best = saveBest(this.score);
      this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x080d15, .88).setDepth(50);
      showResults(this.score, this.survival, best, () => this.startRound(), () => this.scene.restart());
    }
  }
  private get score(): number { return Math.floor(this.survival * 10) + this.bonus; }
}
