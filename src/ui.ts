import Phaser from "phaser";
import { formatTime } from "./config";
import { t, getLocale, setLocale, type TextKey } from "./locales";
import {
  profile,
  persistProfile,
  ACHIEVEMENTS,
  type Achievement,
} from "./profile";
import { validateName, PALETTE } from "./shared/identity";
import { updateOrientation } from "./device";
import { audio } from "./audio";
import {
  JOYSTICK_SIZES,
  joystickSize,
  setJoystickSize,
  applyJoystickSize,
  type JoystickSize,
} from "./controlSettings";
const overlay = document.querySelector<HTMLDivElement>("#overlay")!;
let currentScreen: (() => void) | undefined;
export const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
export const colorHex = (color: number): string =>
  `#${PALETTE[color].toString(16)}`;
export function button(id: string, key: TextKey, secondary = false): string {
  return `<button id="${id}" ${secondary ? 'class="secondary"' : ""}>${t(key)}</button>`;
}
export function bind(id: string, action: () => void): void {
  overlay.querySelector<HTMLElement>(`#${id}`)!.onclick = () => {
    audio.unlock();
    audio.play("click");
    action();
  };
}
export function panel(
  title: string,
  content: string,
  rerender?: () => void,
): void {
  currentScreen = rerender;
  overlay.innerHTML = `<div class="panel"><h2>${title}</h2>${content}</div>`;
  document.body.classList.remove("playing");
  updateOrientation();
}
export function clearMenu(): void {
  overlay.innerHTML = "";
  currentScreen = undefined;
}
function settings(): string {
  return `<div class="settings"><div aria-label="${t("language")}"><button id="en" class="chip ${getLocale() === "en" ? "selected" : ""}">EN</button><button id="ru" class="chip ${getLocale() === "ru" ? "selected" : ""}">RU</button></div><button id="sound" class="chip">${t(profile.sound ? "soundOn" : "soundOff")}</button><button id="control-settings" class="chip">${t("controlSettings")}</button></div>`;
}
function bindSettings(): void {
  bind("control-settings", () => showControls(currentScreen!));
  bind("en", () => setLocale("en"));
  bind("ru", () => setLocale("ru"));
  bind("sound", () => {
    audio.toggle();
    currentScreen?.();
  });
}
export function showControls(back: () => void): void {
  const render = () => showControls(back);
  panel(
    t("controlSettings"),
    `<p>${t("joystickSize")}</p><div class="size-options">${Object.keys(
      JOYSTICK_SIZES,
    )
      .map(
        (size) =>
          `<button class="chip ${size === joystickSize ? "selected" : ""}" id="size-${size}" aria-pressed="${size === joystickSize}">${t(size as JoystickSize)}</button>`,
      )
      .join(
        "",
      )}</div><div class="joystick-preview" aria-label="${t("joystickPreview")}"><div class="joystick-disc"><span></span></div></div><p class="hint">${t("dashHelp")}</p>${button("back", "back")}`,
    render,
  );
  for (const size of Object.keys(JOYSTICK_SIZES) as JoystickSize[])
    bind(`size-${size}`, () => {
      setJoystickSize(size);
      render();
    });
  bind("back", back);
}
export function updateChrome(): void {
  applyJoystickSize();
  document.documentElement.lang = getLocale();
  document.querySelector("#header-note")!.textContent = t("protocol");
  document.querySelector("#motto")!.textContent = t("motto");
  document.querySelector("#edition")!.textContent = `${t("arcade")} / V.1.0`;
  document.querySelector("#rotate")!.innerHTML =
    `<div><strong>${t("rotate")}</strong><p>${t("rotateHint")}</p><small id="rotate-online">${t("onlineContinues")}</small></div>`;
  document
    .querySelector("#pause-button")!
    .setAttribute("aria-label", t("paused"));
  document
    .querySelector("#joystick")!
    .setAttribute("aria-label", t("controls"));
  document.title = `RULESHIFT — ${t("tagline")}`;
}
window.addEventListener("languagechange", () => {
  updateChrome();
  currentScreen?.();
});
export function showMenu(play: () => void, online: () => void): void {
  const render = () => showMenu(play, online);
  if (!profile.name) {
    showProfile(() => showMenu(play, online), true);
    return;
  }
  currentScreen = render;
  document.body.classList.remove("playing", "online-match");
  updateOrientation();
  overlay.innerHTML = `<div class="menu"><div class="eyebrow">${t("protocol")}</div><h1>RULE<span>SHIFT</span></h1><p class="tagline">${t("tagline")}</p><div class="identity"><i style="background:${colorHex(profile.color)}"></i>${escapeHtml(profile.name)}</div><div class="menu-actions">${button("solo", "solo")}${button("online", "online", true)}${button("profile", "profile", true)}</div><div class="best">${t("best")}: <strong>${profile.stats.best}</strong></div>${settings()}<button id="how" class="text-button">${t("how")}</button><div class="controls">${t("controls")}</div></div>`;
  bind("solo", play);
  bind("online", online);
  bind("profile", () => showProfile(render));
  bindSettings();
  bind("how", () => {
    const help = () => {
      panel(
        t("how"),
        `<p class="help">${t("howText")}</p><p class="hint">${t("dashHelp")}</p><p class="hint">${t("pickupLegend")}</p>${button("back", "back")}`,
        help,
      );
      bind("back", render);
    };
    help();
  });
}
export function showProfile(back: () => void, first = false): void {
  let selected = profile.color;
  const render = () => showProfile(back, first);
  const s = profile.stats;
  const stats: [TextKey, string | number][] = [
    ["best", s.best],
    ["longest", formatTime(s.longest)],
    ["games", s.soloGames + s.onlineGames],
    ["soloGames", s.soloGames],
    ["onlineGames", s.onlineGames],
    ["wins", s.wins],
    ["survived", s.rules],
  ];
  panel(
    t(first ? "chooseName" : "profile"),
    `<form id="profile-form"><label for="player-name">${t("name")}</label><input id="player-name" autocomplete="nickname" maxlength="16" value="${escapeHtml(profile.name)}" placeholder="${t("name")}" required minlength="3"><p class="hint">${t("nameHint")}</p><p>${t("chooseColor")}</p><div class="palette">${PALETTE.map((_, i) => `<button type="button" data-color="${i}" aria-label="${t(`color${i}` as TextKey)}" aria-pressed="${selected === i}" style="--swatch:${colorHex(i)}">${selected === i ? "✓" : ""}</button>`).join("")}</div><p id="profile-error" class="error" role="alert"></p><button type="submit">${t(first ? "continue" : "save")}</button></form>${settings()}${first ? "" : `<div class="stats">${stats.map(([key, value]) => `<div><span>${t(key)}</span><strong>${value}</strong></div>`).join("")}</div><h3>${t("achievements")} ${profile.achievements.length}/${ACHIEVEMENTS.length}</h3><div class="achievements">${ACHIEVEMENTS.map((id) => `<div class="${profile.achievements.includes(id) ? "unlocked" : ""}"><b>${profile.achievements.includes(id) ? "✓" : "○"} ${t(id)}</b><small>${t(`${id}Desc` as TextKey)}</small></div>`).join("")}</div>${button("back", "back", true)}`}`,
    render,
  );
  overlay
    .querySelectorAll<HTMLButtonElement>("[data-color]")
    .forEach((element) => {
      element.onclick = () => {
        selected = Number(element.dataset.color);
        overlay
          .querySelectorAll<HTMLButtonElement>("[data-color]")
          .forEach((b) => {
            const active = Number(b.dataset.color) === selected;
            b.setAttribute("aria-pressed", String(active));
            b.textContent = active ? "✓" : "";
          });
      };
    });
  overlay.querySelector<HTMLFormElement>("#profile-form")!.onsubmit = (
    event,
  ) => {
    event.preventDefault();
    const name = validateName(
      overlay.querySelector<HTMLInputElement>("#player-name")!.value,
    );
    if (!name) {
      overlay.querySelector("#profile-error")!.textContent = t("invalidName");
      return;
    }
    profile.name = name;
    profile.color = selected;
    persistProfile();
    audio.unlock();
    back();
  };
  bindSettings();
  if (!first) bind("back", back);
}
export function showResults(
  score: number,
  time: number,
  best: number,
  play: () => void,
  menu: () => void,
): void {
  const render = () => showResults(score, time, best, play, menu);
  panel(
    t("gameOver"),
    `<p class="tagline">${t("resultHint")}</p><div class="identity"><i style="background:${colorHex(profile.color)}"></i>${escapeHtml(profile.name)}</div><div class="results"><div>${t("score")}<strong>${score}</strong></div><div>${t("time")}<strong>${formatTime(time)}</strong></div><div>${t("best")}<strong>${best}</strong></div></div>${button("again", "again")}${button("menu", "menu", true)}`,
    render,
  );
  bind("again", play);
  bind("menu", menu);
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string): void {
  const node = document.querySelector<HTMLElement>("#toast")!;
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 3500);
}
export function notifyAchievements(ids: Achievement[]): void {
  if (ids.length) {
    audio.play("achievement");
    toast(`${t("achievementUnlocked")}: ${ids.map((id) => t(id)).join(" · ")}`);
  }
}
export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size = 14,
  color = "#edf4f4",
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, {
      fontFamily: "Arial, sans-serif",
      fontSize: size,
      color,
    })
    .setDepth(20);
}
