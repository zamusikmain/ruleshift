export const WIDTH = 1160;
export const HEIGHT = 720;
export const ARENA = { left: 46, right: 1114, top: 144, bottom: 654 };
export const C = {
  lime: 0xb9fa6a,
  cyan: 0x65dce9,
  danger: 0xff647d,
  muted: 0x77909f,
};
export const center = { x: 580, y: 399 };
export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
