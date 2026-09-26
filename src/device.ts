export function isPortraitTouch(): boolean {
  return (
    navigator.maxTouchPoints > 0 &&
    matchMedia("(pointer:coarse)").matches &&
    matchMedia("(orientation:portrait)").matches
  );
}
export function updateOrientation(): void {
  document.querySelector<HTMLElement>("#rotate")!.hidden = !(
    document.body.classList.contains("playing") && isPortraitTouch()
  );
}
