import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Exercise rule timing without a renderer; only Phaser's drawing/random helpers are stubbed.
function harness(index, position = { x: 580, y: 399 }) {
  const graphics = new Proxy({}, { get: () => () => graphics });
  class Vector2 {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    normalize() {
      const length = Math.hypot(this.x, this.y) || 1;
      this.x /= length;
      this.y /= length;
      return this;
    }
    scale(n) {
      this.x *= n;
      this.y *= n;
      return this;
    }
  }
  const phaser = {
    Math: {
      Distance: { Between: (x, y, a, b) => Math.hypot(x - a, y - b) },
      Between: (a) => a,
      Vector2,
    },
    Utils: {
      Array: {
        GetRandom: (values) => (values.includes(index) ? index : values[0]),
        Shuffle: (values) => values,
      },
    },
  };
  const modules = new Map();
  function load(file) {
    file = resolve("src", file);
    if (!existsSync(`${file}.ts`)) file = resolve(file, "index");
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    const js = ts.transpileModule(readFileSync(`${file}.ts`, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(js, {
      exports,
      require: (name) =>
        name === "phaser"
          ? { default: phaser }
          : load(resolve(dirname(file), name)),
    });
    modules.set(file, exports);
    return exports;
  }
  let hits = 0,
    rewards = 0;
  const player = { ...position, radius: 12, distance: 0, hp: 3 };
  const rules = new (load("rules").RuleSystem)(
    { add: { graphics: () => graphics, text: () => graphics } },
    player,
    () => {},
    () => hits++,
    () => rewards++,
  );
  const step = (seconds) => {
    for (let i = 0; i < Math.ceil(seconds * 100); i++) rules.update(0.01, 0);
  };
  while (rules.phase !== "active") rules.update(0.01, 0);
  return { rules, player, step, hits: () => hits, rewards: () => rewards };
}

test("KEEP MOVING: idle timeout and survival reward", () => {
  const idle = harness(0);
  idle.step(1.19);
  assert.equal(idle.hits(), 0);
  idle.step(0.03);
  assert.equal(idle.hits(), 1);
  const moving = harness(0);
  moving.player.distance = 2;
  moving.step(6.1);
  assert.equal(moving.hits(), 0);
  assert.equal(moving.rewards(), 1);
});
test("DANGER ZONES: warning is safe, active zone hurts, cleanup stops damage", () => {
  const h = harness(1, { x: 155, y: 235 });
  h.step(1.49);
  assert.equal(h.hits(), 0);
  h.step(0.04);
  assert.ok(h.hits() > 0);
  h.step(4.6);
  const hits = h.hits();
  h.step(1);
  assert.equal(h.hits(), hits);
  assert.equal(h.rewards(), 0);
});
test("CENTER NOW: check only at deadline, safe center succeeds", () => {
  const outside = harness(2, { x: 100, y: 200 });
  outside.step(3.99);
  assert.equal(outside.hits(), 0);
  outside.step(0.03);
  assert.equal(outside.hits(), 1);
  outside.step(1);
  assert.equal(outside.hits(), 1);
  const inside = harness(2);
  inside.step(6.1);
  assert.equal(inside.hits(), 0);
  assert.equal(inside.rewards(), 1);
});
test("DODGE: no immediate hit, aimed projectiles eventually hit stationary target", () => {
  const h = harness(3);
  h.step(1);
  assert.equal(h.hits(), 0);
  h.step(5.1);
  assert.ok(h.hits() > 0);
});
test("DON'T MOVE: preparation and release permit movement; freeze penalizes it", () => {
  const h = harness(4);
  h.player.distance = 2;
  h.step(1.79);
  assert.equal(h.hits(), 0);
  h.step(0.2);
  assert.ok(h.hits() > 0);
  h.step(1.9);
  const hits = h.hits();
  h.step(1);
  assert.equal(h.hits(), hits);
  const still = harness(4);
  still.step(6.1);
  assert.equal(still.rewards(), 1);
});
test("rotation never repeats a rule back-to-back", () => {
  const h = harness(0);
  let previous = h.rules.index;
  for (let cycle = 0; cycle < 20; cycle++) {
    while (h.rules.phase !== "rest") h.rules.update(0.05, cycle * 10);
    while (h.rules.phase !== "announce") h.rules.update(0.05, cycle * 10);
    assert.notEqual(h.rules.index, previous);
    previous = h.rules.index;
    while (h.rules.phase !== "active") h.rules.update(0.05, cycle * 10);
  }
});
