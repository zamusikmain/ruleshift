import Phaser from 'phaser';
import { formatTime } from './config';
import { getBest } from './storage';
const overlay = document.querySelector<HTMLDivElement>('#overlay')!;
export function clearMenu(): void { overlay.innerHTML = ''; }
export function showMenu(play: () => void): void {
  overlay.innerHTML = `<div class="menu"><div class="eyebrow">A GAME OF CONSTANT CHANGE</div><h1>RULE<span>SHIFT</span></h1><p class="tagline">Rules change. Survive.</p><button id="play">PLAY <span aria-hidden="true">↗</span></button><div class="best">BEST SCORE:<strong>${getBest().toString().padStart(4, '0')}</strong></div><div class="controls"><span class="keys"><span>W</span><span>A</span><span>S</span><span>D</span></span> / Arrow Keys to move</div><div class="rule-index"><span><b>01</b> KEEP MOVING</span><span><b>02</b> DANGER ZONES</span><span><b>03</b> CENTER NOW</span><span><b>04</b> DODGE</span><span><b>05</b> DON'T MOVE</span></div></div>`;
  overlay.querySelector<HTMLButtonElement>('#play')!.onclick = play;
}
export function showResults(score: number, time: number, best: number, play: () => void, menu: () => void): void {
  overlay.innerHTML = `<div class="menu over"><div class="eyebrow">SURVIVAL PROTOCOL ENDED</div><h1>GAME OVER<span>.</span></h1><p class="tagline">Every shift is another chance.</p><div class="results"><div>SCORE<strong>${score}</strong></div><div>TIME SURVIVED<strong>${formatTime(time)}</strong></div><div>BEST SCORE<strong>${best}</strong></div></div><button id="again">PLAY AGAIN ↗</button><button class="secondary" id="menu">MAIN MENU</button></div>`;
  overlay.querySelector<HTMLButtonElement>('#again')!.onclick = play;
  overlay.querySelector<HTMLButtonElement>('#menu')!.onclick = menu;
}
export function label(scene: Phaser.Scene, x: number, y: number, text: string, size = 14, color = '#edf4f4'): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, { fontFamily: 'monospace', fontSize: size, color }).setDepth(20);
}
