import { profile, persistProfile } from "./profile";
type Cue =
  | "dash"
  | "pickup"
  | "near"
  | "wave"
  | "click"
  | "warning"
  | "success"
  | "damage"
  | "achievement"
  | "victory";
class AudioSystem {
  private context?: AudioContext;
  unlock(): void {
    if (!profile.sound) return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => {});
    } catch {
      /* Audio is optional. */
    }
  }
  toggle(): void {
    profile.sound = !profile.sound;
    persistProfile();
    if (profile.sound) {
      this.unlock();
      this.play("click");
    }
  }
  play(cue: Cue): void {
    if (!profile.sound || !this.context || this.context.state !== "running")
      return;
    const context = this.context,
      oscillator = context.createOscillator(),
      gain = context.createGain();
    const pitch = {
      dash: 510,
      pickup: 850,
      near: 610,
      wave: 160,
      click: 420,
      warning: 260,
      success: 720,
      damage: 110,
      achievement: 980,
      victory: 1100,
    }[cue];
    oscillator.type = cue === "damage" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(pitch, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      pitch * 1.35,
      context.currentTime + 0.12,
    );
    gain.gain.setValueAtTime(0.045, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}
export const audio = new AudioSystem();
