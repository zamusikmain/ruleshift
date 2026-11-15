import Phaser from "phaser";
import {ApiError} from './leaderboardApi';
import {currentAccount,saveNickname} from './accountProfile';
import {showRankings} from './leaderboardView';
import {showAccounts} from './accountView';
import {checkEntry,resetEntry,chooseGuest} from './authEntry';
import {onSessionRevoked} from './leaderboardApi';
import { formatTime } from "./config";
import { t, getLocale, setLocale, type TextKey } from "./locales";
import {
  profile,
  persistProfile,
  ACHIEVEMENTS,
  type Achievement,
} from "./profile";
import { validateNickname, PALETTE } from "./shared/identity";
import { updateOrientation } from "./device";
import { audio, soundVolume, setSoundVolume } from "./audio";
import { dailySpec,utcDay,type RunResult } from "./shared/offlineProgress";
import { levelProgress,winRate,type ProgressNotice } from "./shared/progression";
import { OFFLINE_MODES,ONLINE_MODES } from "./shared/modes";
import { modeTitle, modeDescription, modeSymbol, profileSummary } from "./uiModel";
import { normalizeInput } from "./shared/movement";
import {
  JOYSTICK_SIZES,
  joystickSize,
  joystickPixels, setJoystickPixels,
  setJoystickSize,
  applyJoystickSize,
  type JoystickSize,
  controlOptions, setControlOptions,
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
  document.body.classList.remove("playing", "portrait-offline", "menu-screen");
  updateOrientation();
}
export function clearMenu(): void {
  document.body.classList.remove("menu-screen");
  overlay.innerHTML = "";
  currentScreen = undefined;
}
import { effectsLevel,setEffects,type EffectsLevel } from "./effects";
function settings(): string {
  return `<div class="settings"><div aria-label="${t("language")}"><button id="en" class="chip ${getLocale() === "en" ? "selected" : ""}">EN</button><button id="ru" class="chip ${getLocale() === "ru" ? "selected" : ""}">RU</button></div><button id="sound" class="chip">${t(profile.sound ? "soundOn" : "soundOff")}</button><button id="control-settings" class="chip">${t("controlSettings")}</button></div>`;
}
function bindSettings(capture = () => {}): void {
  bind("control-settings", () => { capture(); showControls(currentScreen!); });
  bind("en", () => { capture(); setLocale("en"); });
  bind("ru", () => { capture(); setLocale("ru"); });
  bind("sound", () => {
    capture(); audio.toggle();
    currentScreen?.();
  });
}
export function showControls(back: () => void): void {
  const render = () => showControls(back);
  panel(
    t("controlSettings"),
    `<p class="hint">${t("keyboardControls")}</p><p>${t("joystickType")}</p><div class="size-options">${(["fixed","floating"] as const).map(type=>`<button class="chip ${controlOptions.type===type?"selected":""}" id="joystick-${type}" aria-pressed="${controlOptions.type===type}">${t(type==="fixed"?"fixedJoystick":"floatingJoystick")}</button>`).join("")}</div><label>${t("joystickSensitivity")} <input id="joystick-sensitivity" type="range" min="0.5" max="1.5" step="0.05" value="${controlOptions.sensitivity}"></label><label>${t("joystickDeadZone")} <input id="joystick-dead-zone" type="range" min="0.05" max="0.4" step="0.01" value="${controlOptions.deadZone}"></label><p>${t("joystickSize")}</p><div class="size-options">${Object.keys(
      JOYSTICK_SIZES,
    )
      .map(
        (size) =>
          `<button class="chip ${size === joystickSize && JOYSTICK_SIZES[size as JoystickSize] === joystickPixels ? "selected" : ""}" id="size-${size}" aria-pressed="${JOYSTICK_SIZES[size as JoystickSize] === joystickPixels}">${t(size as JoystickSize)}</button>`,
      )
      .join(
        "",
      )}</div><div class="joystick-preview" aria-label="${t("joystickPreview")}"><div class="joystick-disc"><span></span></div></div><p>${t("effectsIntensity")}</p><div class="size-options">${(["low","medium","high"] as const).map(level=>`<button class="chip ${effectsLevel===level?"selected":""}" id="effects-${level}" aria-pressed="${effectsLevel===level}">${t(level==="low"?"effectsLow":level==="medium"?"effectsMedium":"effectsHigh")}</button>`).join("")}</div><p class="hint">${t("effectsHint")}</p><p class="hint">${t("dashHelp")}</p>${button("back", "back")}`,
    render,
  );
  for (const size of Object.keys(JOYSTICK_SIZES) as JoystickSize[])
    bind(`size-${size}`, () => {
      setJoystickSize(size);
      render();
    });
  for (const type of ["fixed","floating"] as const) bind(`joystick-${type}`,()=>{setControlOptions({...controlOptions,type});render();});
  const preview = overlay.querySelector<HTMLElement>(".joystick-preview")!;
  const sizeLabel = document.createElement("label");
  sizeLabel.textContent = t("joystickSize");
  const sizeSlider = document.createElement("input");
  sizeSlider.type = "range"; sizeSlider.min = "104"; sizeSlider.max = "168"; sizeSlider.step = "1"; sizeSlider.value = String(joystickPixels);
  sizeSlider.oninput = () => {
    setJoystickPixels(Number(sizeSlider.value));
    for (const size of Object.keys(JOYSTICK_SIZES) as JoystickSize[]) {
      const node = overlay.querySelector(`#size-${size}`);
      node?.setAttribute("aria-pressed",String(JOYSTICK_SIZES[size]===joystickPixels));
      node?.classList.toggle("selected",JOYSTICK_SIZES[size]===joystickPixels);
    }
  };
  sizeLabel.append(sizeSlider); preview.before(sizeLabel);
  const disc = preview.querySelector<HTMLElement>(".joystick-disc")!;
  const thumb = disc.querySelector<HTMLElement>("span")!;
  let previewPointer: number | null = null;
  const previewMove = (event: PointerEvent) => {
    const rect = disc.getBoundingClientRect(), travel = rect.width * .32;
    const input = normalizeInput((event.clientX - rect.left - rect.width / 2) / travel * controlOptions.sensitivity, (event.clientY - rect.top - rect.height / 2) / travel * controlOptions.sensitivity, controlOptions.deadZone);
    thumb.style.transform = `translate(${input.x * travel}px, ${input.y * travel}px)`;
  };
  preview.onpointerdown = event => {
    if (previewPointer !== null) return;
    previewPointer = event.pointerId; preview.setPointerCapture(event.pointerId);
    if (controlOptions.type === "floating") {
      const area = preview.getBoundingClientRect(), size = disc.getBoundingClientRect().width;
      disc.style.position = "absolute";
      disc.style.left = `${Math.max(0,Math.min(area.width-size,event.clientX-area.left-size/2))}px`;
      disc.style.top = `${Math.max(0,Math.min(area.height-size,event.clientY-area.top-size/2))}px`;
    }
    previewMove(event); event.preventDefault();
  };
  preview.onpointermove = event => { if (event.pointerId === previewPointer) previewMove(event); };
  const previewEnd = (event: PointerEvent) => {
    if (event.pointerId !== previewPointer) return;
    previewPointer = null; thumb.style.transform = "";
    disc.style.position = disc.style.left = disc.style.top = "";
    if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId);
  };
  preview.onpointerup = preview.onpointercancel = preview.onlostpointercapture = previewEnd;
  for (const [id,key] of [["joystick-sensitivity","sensitivity"],["joystick-dead-zone","deadZone"]] as const) overlay.querySelector<HTMLInputElement>(`#${id}`)!.oninput = event => {
    setControlOptions({...controlOptions,[key]:Number((event.target as HTMLInputElement).value)});
  };
  const soundLabel = document.createElement("label");
  soundLabel.textContent = t("soundVolume");
  const volume = document.createElement("input");
  volume.type = "range"; volume.min = "0"; volume.max = "1"; volume.step = ".05"; volume.value = String(soundVolume);
  volume.oninput = () => setSoundVolume(Number(volume.value));
  soundLabel.append(volume); overlay.querySelector(".panel")!.insertBefore(soundLabel, overlay.querySelector("#back"));
  for(const level of ["low","medium","high"] as EffectsLevel[]) bind(`effects-${level}`,()=>{setEffects(level);document.body.dataset.effects=level;render();});
  bind("back", back);
}
export function updateChrome(): void {
  applyJoystickSize();
  document.body.dataset.effects = effectsLevel;
  document.documentElement.lang = getLocale();
  document.querySelector("#header-note")!.textContent = t("protocol");
  document.querySelector("#motto")!.textContent = t("motto");
  document.querySelector("#edition")!.textContent = `${t("arcade")} / V.2.1`;
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
function atmosphere(): string {
  return '<div class="menu-atmosphere" aria-hidden="true"><div class="perspective-grid"></div>'+Array.from({length:6},(_,i)=>'<span class="orbit orbit-'+i+'"></span>').join('')+'</div>';
}
function dashboardPanel(title: string, content: string, render: () => void): void {
  panel(title, content, render);
  document.body.classList.add("menu-screen");
  document.body.dataset.effects = effectsLevel;
  overlay.querySelector(".panel")!.classList.add("dashboard-panel");
}
onSessionRevoked(resetEntry);
let entrySequence=0;
export function showMenu(play: (mode: "classic" | "survival" | "blitz" | "chaos" | "daily") => void, online: (mode: "classic" | "lastOneStanding" | "blitz" | "chaos") => void): void {
  const resume=()=>showMenu(play,online);
  const ticket=++entrySequence;
  const callback=window.location.hash==='#account';
  const failed=callback&&new URLSearchParams(window.location.search).get('auth')==='failed';
  if(callback)window.history.replaceState(null,'',window.location.pathname);
  panel('RULESHIFT',`<p role="status">${t('entryLoading')}</p>`,resume);
  void checkEntry().then(allowed=>{
    if(ticket!==entrySequence)return;
    if(callback){showAccountScreen(resume,failed,true);return;}
    if(allowed)renderGameMenu(play,online);else showAccountScreen(resume,false,true);
  }).catch(()=>{if(ticket!==entrySequence)return;panel('RULESHIFT',`<p role="alert">${t('authNetwork')}</p>${button('entry-retry','rankRefresh')}${button('entry-guest','authGuest')}`,resume);bind('entry-retry',resume);bind('entry-guest',()=>{chooseGuest();resume();});});
}
function showAccountScreen(back:()=>void,failed=false,startup=false):void {
 showAccounts(overlay,(html,render)=>{dashboardPanel(startup?'RULESHIFT':t('profile'),html+settings(),render);overlay.querySelector('.panel')!.classList.toggle('entry-panel',startup);bindSettings();},()=>{void checkEntry().then(allowed=>{if(allowed)back();else showAccountScreen(back,false,true);}).catch(()=>showAccountScreen(back,false,true));},profile.name,account=>{profile.name=account.name;persistProfile();},failed,startup);
}
function renderGameMenu(play: (mode: "classic" | "survival" | "blitz" | "chaos" | "daily") => void, online: (mode: "classic" | "lastOneStanding" | "blitz" | "chaos") => void): void {
  const render = () => showMenu(play, online);

  currentScreen = render;
  document.body.classList.remove("playing", "online-match", "portrait-offline");
  document.body.classList.add("menu-screen");
  document.body.dataset.effects = effectsLevel;
  updateOrientation();
  const cards = (modes: readonly string[], group: string) => modes.map(mode =>
    '<article class="mode-card mode-'+mode+'"><div class="mode-symbol" aria-hidden="true">'+modeSymbol[mode]+'</div><h3>'+t(modeTitle(mode))+'</h3><p>'+t(modeDescription(mode,group==="online"))+'</p><button id="'+group+'-'+mode+'" aria-label="'+t("startMode")+' · '+t(group as TextKey)+' · '+t(modeTitle(mode))+'">'+t("startMode")+' <span aria-hidden="true">↗</span></button></article>').join('');
  overlay.innerHTML = atmosphere()+'<div class="dashboard"><nav class="dashboard-nav" aria-label="RULESHIFT"><a class="dashboard-brand" href="#offline-modes">RULE<span>SHIFT</span><small>v2.1</small></a><div class="dashboard-tools">'+button("leaderboard","leaderboard",true)+button("profile","profile",true)+settings()+'</div></nav><div class="dashboard-hero"><div><div class="eyebrow">'+t("arcade")+'</div><h1>'+t("selectAdventure")+'</h1><p>'+t("menuIntro")+'</p></div><button id="player-card" class="player-mini secondary"><i style="background:'+colorHex(profile.color)+'">'+escapeHtml(profile.name.slice(0,1).toUpperCase())+'</i><span>'+escapeHtml(profile.name)+'<small>'+t("playerLevel")+' '+levelProgress(profile.progression.xp).level+'</small></span></button></div><section id="offline-modes" class="mode-section"><div class="section-heading"><h2>'+t("offline")+'</h2><p>'+t("offlineHint")+'</p></div><div class="mode-grid">'+cards(OFFLINE_MODES,"offline")+'</div></section><section class="mode-section"><div class="section-heading"><h2>'+t("online")+'</h2><p>'+t("onlineHint")+'</p></div><div class="mode-grid online-grid">'+cards(ONLINE_MODES,"online")+'</div></section><div class="dashboard-foot"><button id="how" class="text-button">'+t("how")+'</button><small>'+t("controls")+'</small></div></div>';
  for (const mode of OFFLINE_MODES) bind('offline-'+mode,()=>{ if(mode==="survival"||mode==="daily") showOfflineIntro(mode,()=>play(mode),render); else play(mode); });
  for (const mode of ONLINE_MODES) bind('online-'+mode,()=>{void currentAccount().then(account=>{if(account){profile.name=account.name;persistProfile();}if(!profile.name||account?.needsNickname)showProfile(()=>online(mode),true);else online(mode);}).catch(()=>{showLeaderboard(render);});});
  bind("profile",()=>showProfile(render)); bind("player-card",()=>showProfile(render));
  bind("leaderboard",()=>showLeaderboard(render)); bindSettings();
  bind("how",()=>{ const help=()=>{ panel(t("how"),'<p class="help">'+t("howText")+'</p><p class="hint">'+t("dashHelp")+'</p><p class="hint">'+t("pickupLegend")+'</p>'+button("back","back"),help);bind("back",render); };help(); });

}
export function showLeaderboard(back: () => void, failed=false): void {
  showRankings(overlay,(html,render)=>dashboardPanel(t('leaderboard'),html,render),back,profile.name,undefined,failed,()=>showProfile(back));
}
export function showProfile(back: () => void, first = false): void {
  let selected = profile.color, draft = profile.name, tab = "stats", editing = first, saving=false;
  const capture = () => {
    draft = overlay.querySelector<HTMLInputElement>("#player-name")?.value ?? draft;
    editing = overlay.querySelector<HTMLDetailsElement>("#edit-profile")?.open ?? editing;
  };
  const metric = (key: TextKey, value: string | number) => '<div><span>'+t(key)+'</span><strong>'+value+'</strong></div>';
  const render = () => {
    const p=profile.progression,level=levelProgress(p.xp),summary=profileSummary(profile);
    const content = tab === "stats" ? '<h3>'+t("onlineModeStats")+'</h3><div class="record-grid">'+ONLINE_MODES.map(m=>{const r=p.online[m];return '<article class="record-card"><h4>'+t(modeTitle(m))+'</h4><div class="metric-grid">'+metric("games",r.games)+metric("wins",r.wins)+metric("losses",r.losses)+metric("draws",r.draws)+metric("winRate",winRate(r)+'%')+metric("winStreak",r.streak)+metric("bestWinStreak",r.bestStreak)+metric("time",formatTime(r.bestTime))+metric("score",r.bestScore)+'</div></article>';}).join('')+'</div><h3>'+t("offline")+'</h3><div class="record-grid">'+OFFLINE_MODES.map(m=>{const r=p.offline[m];return '<article class="record-card"><h4>'+t(modeTitle(m))+'</h4><div class="metric-grid">'+metric("games",m==="survival"?Math.max(r.games,profile.offline.survival.games):r.games)+metric("offlineEvents",r.totalEvents)+'</div></article>';}).join('')+'</div><div class="metric-grid">'+metric("soloGames",profile.stats.soloGames)+metric("survived",profile.stats.rules)+metric("survivalTotalTime",formatTime(profile.offline.survival.totalTime))+metric("survivalTotalEvents",profile.offline.survival.totalEvents)+metric("survivalTotalScore",profile.offline.survival.totalScore)+metric("localMedals",profile.offline.localDailyMedals)+'</div>' : tab === "records" ? '<h3>'+t("offlineRecords")+'</h3><div class="record-grid">'+OFFLINE_MODES.map(m=>{const r=p.offline[m];return '<article class="record-card"><h4>'+t(modeTitle(m))+'</h4><div class="metric-grid">'+metric("games",r.games)+metric("time",formatTime(m==="survival"?Math.max(r.bestTime,profile.offline.survival.bestTime):r.bestTime))+metric("score",m==="survival"?Math.max(r.bestScore,profile.offline.survival.bestScore):r.bestScore)+metric("offlineEvents",m==="survival"?Math.max(r.bestEvents,profile.offline.survival.bestEvents):r.bestEvents)+'</div></article>';}).join('')+'</div><p class="hint">'+t("best")+': '+profile.stats.best+' · '+t("longest")+': '+formatTime(profile.stats.longest)+'</p>' : tab === "achievements" ? '<div class="achievement-grid">'+ACHIEVEMENTS.map(id=>'<article class="achievement-card '+(profile.achievements.includes(id)?'unlocked':'')+'"><b>'+(profile.achievements.includes(id)?'✓':'○')+' '+t(id)+'</b><p>'+t((id+"Desc") as TextKey)+'</p></article>').join('')+'</div>' : '<div class="daily-list">'+(profile.offline.daily.slice().reverse().map(row=>'<article><b>'+escapeHtml(row.date)+' UTC</b><span>'+t(row.completed?"dailyComplete":"dailyFailed")+'</span><small>'+t("score")+': '+row.score+' · '+t("attempts")+': '+row.attempts+'</small></article>').join('') || '<p>'+t("noHistory")+'</p>')+'</div>';
    const form='<form id="profile-form"><label for="player-name">'+t("name")+'</label><input id="player-name" autocomplete="nickname" maxlength="16" value="'+escapeHtml(draft)+'" placeholder="'+t("name")+'" required minlength="3"><p class="hint">'+t("nameHint")+'</p><p>'+t("chooseColor")+'</p><div class="palette">'+PALETTE.map((_,i)=>'<button type="button" data-color="'+i+'" aria-label="'+t(('color'+i) as TextKey)+'" aria-pressed="'+(selected===i)+'" style="--swatch:'+colorHex(i)+'">'+(selected===i?'✓':'')+'</button>').join('')+'</div><p id="profile-error" class="error" role="alert"></p><button type="submit">'+t(first?"continue":"save")+'</button></form>';
    dashboardPanel(t(first?"chooseName":"profile"),first?form+settings():'<div class="profile-heading"><i class="avatar" style="background:'+colorHex(profile.color)+'">'+escapeHtml(profile.name.slice(0,1).toUpperCase())+'</i><div><h3>'+escapeHtml(profile.name)+'</h3><span>'+t("playerLevel")+' '+level.level+' / 100</span><progress aria-label="'+t("xpProgress")+'" max="'+(level.required||1)+'" value="'+(level.level===100?1:level.current)+'"></progress><small>'+(level.level===100?t("maxLevel"):level.current+'/'+level.required+' XP')+'</small></div></div><div class="profile-summary metric-grid">'+metric("wins",summary.wins)+metric("games",summary.matches)+metric("bestWinStreak",summary.bestStreak)+metric("achievements",summary.achievements+'/'+ACHIEVEMENTS.length)+'</div><p class="hint">'+t("localProgressOnly")+'</p>'+button('profile-account','accountSettings')+'<details id="edit-profile" '+(editing?'open':'')+'><summary>'+t("editProfile")+'</summary>'+form+'</details>'+settings()+'<div class="profile-tabs" role="tablist" aria-label="'+t("profile")+'">'+["stats","records","achievements","daily"].map((id,i)=>'<button role="tab" tabindex="'+(tab===id?'0':'-1')+'" id="tab-'+id+'" aria-controls="profile-content" aria-selected="'+(tab===id)+'" class="'+(tab===id?'selected':'')+'">'+t((["statisticsTab","recordsTab","achievementsTab","dailyTab"] as const)[i])+'</button>').join('')+'</div><div id="profile-content" role="tabpanel" aria-labelledby="tab-'+tab+'">'+content+'</div>'+button("back","back",true),render);
    overlay.querySelectorAll<HTMLButtonElement>("[data-color]").forEach(element=>{element.onclick=()=>{selected=Number(element.dataset.color);overlay.querySelectorAll<HTMLButtonElement>("[data-color]").forEach(b=>{const active=Number(b.dataset.color)===selected;b.setAttribute("aria-pressed",String(active));b.textContent=active?'✓':'';});};});
    overlay.querySelector<HTMLFormElement>("#profile-form")!.onsubmit=async event=>{event.preventDefault();if(saving)return;const form=overlay.querySelector("#profile-form");const color=selected;const name=validateNickname(overlay.querySelector<HTMLInputElement>("#player-name")!.value);if(!name){overlay.querySelector("#profile-error")!.textContent=t("invalidName");return;}saving=true;try{await saveNickname(name);}catch(cause){const error=overlay.querySelector("#profile-error");if(error)error.textContent=t(cause instanceof ApiError&&cause.status===429?"authRate":"rankingUnavailable");return;}finally{saving=false;}if(overlay.querySelector("#profile-form")!==form)return;profile.name=name;profile.color=color;persistProfile();audio.unlock();back();};
    if(!first)bind('profile-account',()=>showAccountScreen(back));
    bindSettings(capture);
    if(!first){for(const id of ["stats","records","achievements","daily"]) bind('tab-'+id,()=>{capture();tab=id;render();overlay.querySelector<HTMLElement>('#tab-'+id)!.focus();});for(const [index,id] of ["stats","records","achievements","daily"].entries()) overlay.querySelector<HTMLElement>('#tab-'+id)!.onkeydown=event=>{let next=index;if(event.key==="ArrowRight")next=(index+1)%4;else if(event.key==="ArrowLeft")next=(index+3)%4;else if(event.key==="Home")next=0;else if(event.key==="End")next=3;else return;event.preventDefault();capture();tab=["stats","records","achievements","daily"][next];render();overlay.querySelector<HTMLElement>('#tab-'+tab)!.focus();};bind("back",back);}
  };render();
}
export function showOfflineIntro(mode:"survival"|"daily",play:()=>void,back:()=>void):void {
  const spec=dailySpec(),render=()=>showOfflineIntro(mode,play,back),s=profile.offline.survival;
  const history=profile.offline.daily.slice().reverse().map(row=>`<div><b>${escapeHtml(row.date)} UTC · ${t(row.completed?"dailyComplete":"dailyFailed")}</b><small>${t("score")}: ${row.score} · ${t("attempts")}: ${row.attempts}</small></div>`).join("");
  panel(t(mode),mode==="daily"?`<p>${spec.date} UTC</p><p>${t("dailyGoal")}</p><p class="hint">${t("localOnly")}</p><div class="menu-actions">${button("offline-start","continue")}${button("back","back",true)}</div><h3>${t("dailyHistory")}</h3><div class="achievements">${history||`<p>${t("noHistory")}</p>`}</div>`:`<p>${t("survivalGoal")}</p><div class="results"><div>${t("survivalBestTime")}<strong>${formatTime(s.bestTime)}</strong></div><div>${t("survivalBestScore")}<strong>${s.bestScore}</strong></div><div>${t("survivalBestEvents")}<strong>${s.bestEvents}</strong></div></div>${button("offline-start","continue")}${button("back","back",true)}`,render);
  bind("offline-start",()=>{if(mode==="daily"&&utcDay()!==spec.date) render();else play();});bind("back",back);
}
export function showOfflineResults(mode:"survival"|"daily",result:RunResult,spec:ReturnType<typeof dailySpec>|undefined,completed:boolean,rewarded:boolean,play:()=>void,menu:()=>void):void {
  const render=()=>showOfflineResults(mode,result,spec,completed,rewarded,play,menu),s=profile.offline.survival;
  panel(t(mode),`<p>${mode==="daily"?`${spec?.date} UTC · ${t(completed?"dailyComplete":"dailyFailed")}`:t("gameOver")}</p><div class="results"><div>${t("score")}<strong>${result.score}</strong></div><div>${t("time")}<strong>${formatTime(result.time)}</strong></div><div>${t("offlineEvents")}<strong>${result.events}</strong></div></div>${mode==="survival"?`<p>${t("survivalBestTime")}: ${formatTime(s.bestTime)} · ${t("survivalBestScore")}: ${s.bestScore} · ${t("survivalBestEvents")}: ${s.bestEvents}</p>`:`<p>${t(rewarded?"localMedalEarned":completed?"dailyReplay":"localOnly")}</p>`}${button("again","again")}${button("menu","menu",true)}`,render);
  bind("again",play);bind("menu",menu);
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
const notices:string[]=[];
export function toast(message: string): void {
  if(notices.length>=5)notices.pop();
  notices.push(message);
  if(notices.length>1)return;
  displayNotice();
}
function displayNotice():void {
  const node = document.querySelector<HTMLElement>("#toast")!;
  node.textContent = notices[0];
  node.className=`notice-${effectsLevel}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    notices.shift();
    if(notices.length){displayNotice();return;}
    node.hidden = true;
  }, 3500);
}
export function notifyProgress(notice:ProgressNotice|null,achievements:Achievement[]):void {
  const messages:string[]=[];
  if(notice?.xp)messages.push(`+${notice.xp} XP`);
  if(notice?.levelUp)messages.push(`${t("levelUp")} ${levelProgress(profile.progression.xp).level}`);
  if(notice?.record)messages.push(t("personalRecord"));
  if(achievements.length){audio.play("achievement");messages.push(`${t("achievementUnlocked")}: ${achievements.map(id=>t(id)).join(" · ")}`);}
  if(messages.length)toast(messages.join(" · "));
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
