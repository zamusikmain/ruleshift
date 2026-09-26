import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load.mjs";
test("orientation overlay is limited to portrait touch devices", () => {
  let coarse = false, portrait = true;
  const navigator = { maxTouchPoints: 0 }, overlay = { hidden: true };
  const device = loadModule("device", { navigator, matchMedia: query => ({ matches: query.includes("coarse") ? coarse : portrait }), document: { querySelector: () => overlay } });
  device.updateOrientation(); assert.equal(overlay.hidden, true);
  navigator.maxTouchPoints = 5; device.updateOrientation(); assert.equal(overlay.hidden, true);
  coarse = true; device.updateOrientation(); assert.equal(overlay.hidden, false);
  portrait = false; device.updateOrientation(); assert.equal(overlay.hidden, true);
});
test("joystick is analog, has a dead zone and resets on all pointer/lifecycle endings", () => {
  const thumb = { style: {} };
  const base = new EventTarget();
  base.querySelector = () => thumb;
  base.setPointerCapture = () => {};
  base.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  });
  const window = new EventTarget(),
    document = new EventTarget();
  document.querySelector = () => base;
  document.body = { classList: { contains: () => true } };
  const keys = Object.fromEntries(
    "W A S D UP DOWN LEFT RIGHT".split(" ").map((name) => [
      name,
      {
        isDown: false,
        reset() {
          this.isDown = false;
        },
      },
    ]),
  );
  const scene = {
    input: { keyboard: { addKeys: () => keys } },
    events: { once: () => {} },
  };
  const { UnifiedInput } = loadModule(
    "input",
    { window, document, AbortController },
    { phaser: { default: { Scenes: { Events: { SHUTDOWN: "shutdown" } } } } },
  );
  const input = new UnifiedInput(scene);
  const pointer = (type, x = 50, y = 50, pointerId = 1) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX: x, clientY: y, pointerId });
    base.dispatchEvent(event);
  };
  pointer("pointerdown", 52, 52);
  assert.equal(input.read().x, 0);
  pointer("pointermove", 68, 50);
  assert.ok(input.read().x > 0.3 && input.read().x < 0.6);
  pointer("pointermove", 100, 100);
  assert.ok(Math.hypot(input.read().x, input.read().y) <= 1.000001);
  pointer("pointerup", 100, 100, 2);
  assert.ok(
    input.read().x > 0,
    "another finger must not stop the owning pointer",
  );
  for (const ending of ["pointerup", "pointercancel", "lostpointercapture"]) {
    pointer(ending);
    assert.equal(input.read().x, 0);
    pointer("pointerdown", 90, 50);
  }
  for (const ending of ["blur", "resize"]) {
    window.dispatchEvent(new Event(ending));
    assert.equal(input.read().x, 0);
    pointer("pointerdown", 90, 50);
  }
  document.hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(input.read().x, 0);
  keys.W.isDown = keys.D.isDown = true;
  assert.ok(Math.abs(input.read().x - Math.SQRT1_2) < 0.0001);
  input.destroy();
  assert.equal(input.read().x, 0);
});
