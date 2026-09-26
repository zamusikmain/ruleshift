import Phaser from "phaser";
import { normalizeInput, type Movement } from "./shared/movement";
import { JOYSTICK_DEAD_ZONE, JOYSTICK_TRAVEL } from "./controlSettings";
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
    this.base.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.enabled || this.pointer !== null) return;
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
    this.touch = normalizeInput(raw.x, raw.y, JOYSTICK_DEAD_ZONE);
    this.thumb.style.transform = `translate(${raw.x * radius}px, ${raw.y * radius}px)`;
  }
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.reset();
    document.body.classList.toggle("controls-active", enabled);
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
    Object.values(this.keys).forEach((key) => key.reset());
  }
  destroy(): void {
    this.setEnabled(false);
    this.reset();
    this.abort.abort();
  }
}
