import Phaser from "phaser";
import { normalizeInput, type Movement } from "./shared/movement";
export class UnifiedInput {
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
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
        if (this.pointer !== null) return;
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
    window.addEventListener("blur", () => this.reset(), options);
    window.addEventListener(
      "keydown",
      (event) => {
        if (
          document.body.classList.contains("playing") &&
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
      radius = rect.width * 0.35;
    const raw = normalizeInput(
      (event.clientX - rect.left - rect.width / 2) / radius,
      (event.clientY - rect.top - rect.height / 2) / radius,
    );
    this.touch = normalizeInput(raw.x, raw.y, 0.16);
    this.thumb.style.transform = `translate(${raw.x * radius}px, ${raw.y * radius}px)`;
  }
  read(): Movement {
    const k = this.keys;
    const keyboard = normalizeInput(
      Number(k.D.isDown || k.RIGHT.isDown) -
        Number(k.A.isDown || k.LEFT.isDown),
      Number(k.S.isDown || k.DOWN.isDown) - Number(k.W.isDown || k.UP.isDown),
    );
    return this.pointer !== null ? this.touch : keyboard;
  }
  reset(): void {
    this.pointer = null;
    this.touch = { x: 0, y: 0 };
    this.thumb.style.transform = "";
    Object.values(this.keys).forEach((key) => key.reset());
  }
  destroy(): void {
    this.reset();
    this.abort.abort();
  }
}
