import Phaser from "phaser";
import { normalizeInput, type Movement } from "./shared/movement";
import { controlOptions, JOYSTICK_TRAVEL } from "./controlSettings";
export class UnifiedInput {
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private enabled = false;
  private dashRequested = false;
  private waveRequested = false;
  private pointer: number | null = null;
  private touch: Movement = { x: 0, y: 0 };
  private base = document.querySelector<HTMLElement>("#joystick")!;
  private thumb = this.base.querySelector<HTMLElement>("span")!;
  private abort = new AbortController();
  constructor(scene: Phaser.Scene) {
    this.keys = scene.input.keyboard!.addKeys(
      "W,A,S,D,UP,DOWN,LEFT,RIGHT",
      false,
    ) as Record<string, Phaser.Input.Keyboard.Key>;
    const options = { signal: this.abort.signal };
    let touchMode = false;
    const inputMode = (touch: boolean) => {
      document.body.classList.toggle("touch-input", touch);
      if (!touch && touchMode) this.reset();
      touchMode = touch;
    };
    inputMode(typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches);
    window.addEventListener("pointerdown", (event) => {
      if ((event as PointerEvent).pointerType === "touch") inputMode(true);
      else if ((event as PointerEvent).pointerType === "mouse") inputMode(false);
    }, options);
    window.addEventListener("keydown", () => inputMode(false), options);
    window.addEventListener("controlschange", () => this.reset(), options);
    document.addEventListener("pointerdown", (event) => {
      if (!this.enabled || controlOptions.type !== "floating" || this.pointer !== null) return;
      const p = event as PointerEvent;
      if (p.pointerType !== "touch" || (p.target as Element)?.closest?.("button,a,input,select,textarea,#overlay,#joystick")) return;
      const area = document.querySelector<HTMLElement>("#game")?.getBoundingClientRect();
      if (!area || p.clientX < area.left || p.clientX > area.left + area.width * .5 || p.clientY < area.top + area.height * .45 || p.clientY > area.bottom) return;
      const size = this.base.getBoundingClientRect().width;
      const x = Math.max(area.left + size / 2, Math.min(area.left + area.width * .5 - size / 2, p.clientX));
      const y = Math.max(area.top + size / 2, Math.min(area.bottom - size / 2, p.clientY));
      this.base.style.left = `${x - size / 2}px`;
      this.base.style.top = `${y - size / 2}px`;
      this.base.style.bottom = "auto";
      this.base.style.position = "fixed";
      this.base.classList.add("engaged");
      inputMode(true);
      this.pointer = p.pointerId;
      this.base.setPointerCapture(p.pointerId);
      this.track(p);
      p.preventDefault();
    }, options);
    this.base.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.enabled || this.pointer !== null) return;
        this.base.classList?.add("engaged");
        event.preventDefault();
        this.pointer = event.pointerId;
        this.base.setPointerCapture(event.pointerId);
        this.track(event);
      },
      options,
    );
    this.base.addEventListener(
      "pointermove",
      (event) => {
        if (event.pointerId === this.pointer) this.track(event);
      },
      options,
    );
    for (const name of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const)
      this.base.addEventListener(
        name,
        (event) => {
          if (event.pointerId === this.pointer) this.reset();
        },
        options,
      );
    for (const [id, action] of [
      ["dash-button", "dash"],
      ["wave-button", "wave"],
    ] as const) {
      document.querySelector<HTMLElement>(`#${id}`)?.addEventListener(
        "pointerdown",
        (event) => {
          if (!this.enabled) return;
          event.preventDefault();
          if (action === "dash") this.dashRequested = true;
          else this.waveRequested = true;
        },
        options,
      );
    }
    window.addEventListener(
      "keydown",
      (event) => {
        if (!this.enabled || event.repeat) return;
        if (event.code === "Space") {
          event.preventDefault();
          this.dashRequested = true;
        }
        if (event.code === "KeyE") {
          event.preventDefault();
          this.waveRequested = true;
        }
      },
      options,
    );
    window.addEventListener("blur", () => this.reset(), options);
    window.addEventListener(
      "keydown",
      (event) => {
        if (
          this.enabled &&
          ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
            event.key,
          )
        )
          event.preventDefault();
      },
      options,
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.reset();
      },
      options,
    );
    window.addEventListener("resize", () => this.reset(), options);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }
  private track(event: PointerEvent): void {
    const rect = this.base.getBoundingClientRect(),
      radius = rect.width * JOYSTICK_TRAVEL;
    const raw = normalizeInput(
      (event.clientX - rect.left - rect.width / 2) / radius,
      (event.clientY - rect.top - rect.height / 2) / radius,
    );
    this.touch = normalizeInput(raw.x * controlOptions.sensitivity, raw.y * controlOptions.sensitivity, controlOptions.deadZone);
    this.thumb.style.transform = `translate(${raw.x * radius}px, ${raw.y * radius}px)`;
  }
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.reset();
    document.body.classList.toggle("controls-active", enabled);
    document.body.classList.toggle("floating-joystick", controlOptions.type === "floating");
  }
  consumeDash(): boolean {
    const value = this.enabled && this.dashRequested;
    this.dashRequested = false;
    return value;
  }
  consumeWave(): boolean {
    const value = this.enabled && this.waveRequested;
    this.waveRequested = false;
    return value;
  }
  read(): Movement {
    if (!this.enabled) return { x: 0, y: 0 };
    const k = this.keys;
    const keyboard = normalizeInput(
      Number(k.D.isDown || k.RIGHT.isDown) -
        Number(k.A.isDown || k.LEFT.isDown),
      Number(k.S.isDown || k.DOWN.isDown) - Number(k.W.isDown || k.UP.isDown),
    );
    return this.pointer !== null ? this.touch : keyboard;
  }
  reset(): void {
    const pointer = this.pointer;
    this.pointer = null;
    if (pointer !== null && this.base.hasPointerCapture?.(pointer))
      this.base.releasePointerCapture(pointer);
    this.dashRequested = this.waveRequested = false;
    this.touch = { x: 0, y: 0 };
    this.thumb.style.transform = "";
    this.base.classList?.remove("engaged");
    if (this.base.style) { this.base.style.left = ""; this.base.style.top = ""; this.base.style.bottom = ""; this.base.style.position = ""; }
    document.body.classList.toggle("floating-joystick", controlOptions.type === "floating");
    Object.values(this.keys).forEach((key) => key.reset());
  }
  destroy(): void {
    this.setEnabled(false);
    this.reset();
    this.abort.abort();
  }
}
