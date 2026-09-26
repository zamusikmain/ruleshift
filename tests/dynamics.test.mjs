import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load.mjs";
const movement = loadModule("shared/movement");
const { createBody, moveBody, activateDash, damageBody, activateShockwave } =
  movement;
const {
  RuleEngine,
  laserFrame,
  segmentDistance,
  compatible,
  hazardPressure,
  isFrozen,
} = loadModule("shared/ruleEngine");
const { DIRECTIONS, edgeSegment, directionVector } =
  loadModule("shared/direction");
const { validModifier, COMBO_PRESSURE, suddenDeathInset } =
  loadModule("shared/variants");
const { PickupSystem, applyPickup } = loadModule("shared/pickups");
const { Room } = loadModule("shared/room");
const { parseClientMessage } = loadModule("shared/protocol");
const random = {
  pick: (values) => values[0],
  between: (min) => min,
  shuffle: (values) => values,
};
const playingRoom = () => {
  const room = new Room("ABC234", random);
  room.join("a", "token-a", "Alpha", 0);
  room.join("b", "token-b", "Beta", 1);
  room.command("a", { type: "ready", ready: true });
  room.command("b", { type: "ready", ready: true });
  room.command("a", { type: "start" });
  room.tick(3.01);
  return room;
};

test("joystick validates saved sizes, defaults to Large on touch and preserves explicit Small", () => {
  const data = new Map(),
    storage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    };
  const styles = new Map();
  const controls = loadModule("controlSettings", {
    localStorage: storage,
    navigator: { maxTouchPoints: 5 },
    document: {
      documentElement: { style: { setProperty: (k, v) => styles.set(k, v) } },
    },
  });
  assert.equal(controls.joystickSize, "large");
  assert.equal(controls.loadJoystickSize(storage, false), "medium");
  for (const bad of ["huge", "toString", "__proto__", null, 168])
    assert.equal(controls.validJoystickSize(bad), false);
  for (const size of ["small", "medium", "large"]) {
    controls.setJoystickSize(size);
    assert.equal(controls.loadJoystickSize(storage, true), size);
    assert.equal(
      styles.get("--joystick-size"),
      `${controls.JOYSTICK_SIZES[size]}px`,
    );
  }
  controls.setJoystickSize("small");
  assert.equal(controls.loadJoystickSize(storage, true), "small");
  data.set(controls.CONTROL_KEY, "broken");
  assert.equal(controls.loadJoystickSize(storage, true), "large");
});

test("Dash has authoritative cooldown, rejects idle/frozen/dead bodies and stays in bounds", () => {
  const p = createBody(1095, 630);
  assert.equal(activateDash(p, { x: 0, y: 0 }), false);
  assert.equal(activateDash(p, { x: 1, y: 0 }, true), false);
  assert.equal(activateDash(p, { x: 1, y: 1 }), true);
  assert.equal(activateDash(p, { x: 1, y: 0 }), false);
  for (let i = 0; i < 65; i++) moveBody(p, { x: 1, y: 1 }, 0.05);
  assert.ok(p.x <= 1102 && p.y <= 642);
  assert.equal(activateDash(p, { x: -1, y: 0 }), true);
  p.hp = 0;
  p.dashCooldown = 0;
  assert.equal(activateDash(p, { x: 1, y: 0 }), false);
});

test("Online Dash cannot spoof state, activate in lobby, use stale input or spam cooldown", () => {
  const room = playingRoom(),
    p = room.members.get("a").state;
  assert.equal(room.command("a", { type: "dash" }), false);
  room.command("a", { type: "input", x: 1, y: 0 });
  assert.equal(room.command("a", { type: "dash" }), true);
  for (let i = 0; i < 50; i++)
    assert.equal(room.command("a", { type: "dash" }), false);
  assert.equal(p.dashSerial, 1);
  for (const message of [
    { type: "dash", x: 1 },
    { type: "dash", cooldown: 0 },
    { type: "pickup", id: 1 },
    { type: "shockwave", targets: ["b"] },
  ])
    assert.equal(parseClientMessage(JSON.stringify(message)), null);
  assert.equal(parseClientMessage('{"type":"dash"}').type, "dash");
  room.tick(0.5);
  p.dashCooldown = 0;
  assert.equal(room.command("a", { type: "dash" }), false);
  room.phase = "lobby";
  room.command("a", { type: "input", x: 1, y: 0 });
  assert.equal(room.command("a", { type: "dash" }), false);
});

test("Shield absorbs one hit, Heal caps at three, Speed expires and Score Boost multiplies rewards", () => {
  const p = createBody();
  applyPickup(p, "shield");
  assert.equal(damageBody(p), false);
  assert.equal(p.hp, 3);
  assert.equal(p.shield, false);
  p.invulnerable = 0;
  assert.equal(damageBody(p), true);
  assert.equal(p.damageTaken, 1);
  applyPickup(p, "heal");
  applyPickup(p, "heal");
  assert.equal(p.hp, 3);
  applyPickup(p, "speed");
  const normal = createBody();
  for (let i = 0; i < 10; i++) {
    moveBody(p, { x: 1, y: 0 }, 0.05);
    moveBody(normal, { x: 1, y: 0 }, 0.05);
  }
  assert.ok(p.x > normal.x);
  for (let i = 0; i < 100; i++) moveBody(p, { x: 0, y: 0 }, 0.05);
  assert.equal(p.speedTime, 0);
  const { Scoring } = loadModule("shared/scoring"),
    score = new Scoring();
  applyPickup(p, "scoreBoost");
  score.tick(1, p.scoreTime > 0);
  assert.equal(score.complete(), 200);
  assert.equal(score.nearMiss(), 40);
  assert.equal(score.score(1), 260);
  score.tick(1, false);
  assert.equal(score.nearMiss(), 20);
});

test("Pickups require proximity and living player, expire, respect cap and prohibit Online score boost", () => {
  const system = new PickupSystem(true, random),
    rules = new RuleEngine().state,
    p = createBody();
  system.items = [{ id: 1, x: 100, y: 200, kind: "heal", ttl: 8 }];
  p.hp = 2;
  system.update(0.05, [p], rules);
  assert.equal(p.hp, 2);
  p.x = 100;
  p.y = 200;
  p.hp = 0;
  system.update(0.05, [p], rules);
  assert.equal(system.items.length, 1);
  p.hp = 2;
  system.update(0.05, [p], rules);
  assert.equal(p.hp, 3);
  assert.equal(p.pickups, 1);
  assert.equal(system.items.length, 0);
  system.items = [{ id: 2, x: 500, y: 300, kind: "shield", ttl: 0.01 }];
  system.update(0.05, [], rules);
  assert.equal(system.items.length, 0);
  for (let i = 0; i < 400; i++) {
    system.update(0.1, [], rules);
    assert.ok(system.items.length <= 3);
    for (const item of system.items) {
      assert.notEqual(item.kind, "scoreBoost");
      assert.ok(item.x > 46 && item.x < 1114 && item.y > 144 && item.y < 654);
    }
  }
});

test("all four Laser directions use matching warning edge, travel and collision geometry", () => {
  const s = new RuleEngine().state;
  Object.assign(s, { ids: [5], phase: "active", duration: 6 });
  for (const direction of DIRECTIONS) {
    s.direction = direction;
    s.elapsed = 0;
    const warning = laserFrame(s);
    assert.equal(warning.warning, true);
    assert.equal(warning.active, false);
    const start = edgeSegment(direction, 0),
      end = edgeSegment(direction, 1),
      vector = directionVector(direction);
    assert.ok(
      (end.x1 - start.x1) * vector.x + (end.y1 - start.y1) * vector.y > 0,
    );
    s.elapsed = 3;
    const beam = laserFrame(s);
    assert.equal(beam.active, true);
    assert.equal(
      segmentDistance(
        { x: (beam.x1 + beam.x2) / 2, y: (beam.y1 + beam.y2) / 2 },
        beam,
      ),
      0,
    );
    if (direction === "TOP") assert.equal(start.y1, 169);
    if (direction === "BOTTOM") assert.equal(start.y1, 629);
    if (direction === "LEFT") assert.equal(start.x1, 71);
    if (direction === "RIGHT") assert.equal(start.x1, 1089);
  }
});

test("double Laser is sequential with a fresh warning and second direction", () => {
  const s = new RuleEngine().state;
  Object.assign(s, {
    ids: [5],
    phase: "active",
    modifiers: { 5: "double" },
    direction: "RIGHT",
    secondDirection: "BOTTOM",
    duration: 10,
    elapsed: 4.8,
  });
  assert.equal(laserFrame(s).active, false);
  s.elapsed = 5.1;
  assert.equal(laserFrame(s).direction, "BOTTOM");
  assert.equal(laserFrame(s).warning, true);
  assert.equal(laserFrame(s).active, false);
  s.elapsed = 6.6;
  assert.equal(laserFrame(s).active, true);
});

test("modifier whitelist and compatible combos exclude freeze conflicts and reduce pressure", () => {
  for (let id = 0; id < 10; id++) assert.equal(compatible(4, id), false);
  assert.equal(validModifier(5, "double"), true);
  assert.equal(validModifier(8, "giant"), true);
  assert.equal(validModifier(4, "fast"), false);
  assert.equal(validModifier(3, "double"), false);
  assert.equal(compatible(5, 8), true);
  assert.equal(compatible(2, 5), false);
  assert.equal(compatible(1, 5), false);
  const s = new RuleEngine().state;
  s.ids = [5, 8];
  assert.equal(hazardPressure(s), COMBO_PRESSURE);
  assert.ok(COMBO_PRESSURE < 1);
});

test("Perfect requires a complete clean rule, including damage outside rule callbacks", () => {
  for (const damaged of [false, true]) {
    const e = new RuleEngine(random),
      p = { ...createBody(), id: "a" };
    let rewards = 0;
    Object.assign(e.state, { ids: [0], phase: "announce", remaining: 0 });
    e.update(
      0.01,
      0,
      [p],
      () => false,
      () => rewards++,
    );
    for (let i = 0; i < 125; i++) {
      p.distance = 2;
      if (damaged && i === 80) p.damageTaken++;
      e.update(
        0.05,
        0,
        [p],
        () => false,
        () => rewards++,
      );
    }
    assert.equal(rewards, damaged ? 0 : 1);
  }
});

test("Near Miss rewards a passed projectile only once and never rewards a collision", () => {
  const e = new RuleEngine(random),
    p = { ...createBody(), id: "a" };
  let near = 0;
  Object.assign(e.state, {
    ids: [3],
    phase: "active",
    remaining: 4,
    elapsed: 1,
    hazards: [
      {
        id: 42,
        kind: "shot",
        x: p.x + 20,
        y: p.y + 20,
        radius: 7,
        vx: 1,
        vy: 0,
        born: 0,
      },
    ],
  });
  e.nextShot = 20;
  for (let i = 0; i < 10; i++)
    e.update(
      0.01,
      0,
      [p],
      () => false,
      () => {},
      () => {},
      () => near++,
    );
  assert.equal(near, 1);
  e.state.hazards = [
    { id: 43, kind: "shot", x: p.x, y: p.y, radius: 7, vx: 1, vy: 0, born: 0 },
  ];
  e.update(
    0.01,
    0,
    [p],
    () => true,
    () => {},
    () => {},
    () => near++,
  );
  assert.equal(near, 1);
});

test("rare Overload starts late, lasts ten seconds and reuses a compatible pair", () => {
  const e = new RuleEngine(random);
  e.update(
    3,
    179,
    [],
    () => {},
    () => {},
  );
  assert.equal(e.state.event, false);
  e.state.phase = "rest";
  e.state.remaining = 0;
  e.update(
    0.01,
    180,
    [],
    () => {},
    () => {},
  );
  assert.equal(e.state.event, true);
  assert.equal(compatible(...e.state.ids), true);
  e.update(
    2.1,
    182,
    [],
    () => {},
    () => {},
  );
  assert.equal(e.state.duration, 10);
  e.state.phase = "rest";
  e.state.remaining = 0;
  e.update(
    0.01,
    220,
    [],
    () => {},
    () => {},
  );
  assert.equal(e.state.event, false);
});

test("Sudden Death begins gradually, removes healing and server owns bounds pressure", () => {
  const room = playingRoom();
  room.time = 179.99;
  room.rules.state.remaining = 50;
  room.pickups.items = [{ id: 1, x: 100, y: 200, kind: "heal", ttl: 10 }];
  room.tick(0.05);
  assert.equal(room.snapshot().suddenDeath, true);
  assert.equal(room.arenaInset, 0);
  assert.equal(room.pickups.items.length, 0);
  assert.equal(suddenDeathInset(185), 0);
  assert.ok(suddenDeathInset(200) > 0);
  assert.ok(suddenDeathInset(600) <= 180);
  room.time = 210;
  room.members.get("a").state.x = 60;
  room.tick(0.05);
  assert.equal(room.members.get("a").state.hp, 2);
  assert.ok(room.rules.state.pressure > 1);
});

test("Shockwave consumes inventory once, affects only nearby living opponents and clamps movement", () => {
  const p = createBody(1080, 400),
    target = createBody(1100, 400),
    far = createBody(300, 300),
    dead = createBody(1070, 400);
  dead.hp = 0;
  assert.equal(activateShockwave(p, [p, target]), false);
  p.shockwave = true;
  assert.equal(activateShockwave(p, [p, target, far, dead]), true);
  assert.equal(activateShockwave(p, [p, target]), false);
  assert.ok(target.knockTime > 0);
  assert.equal(far.knockTime, 0);
  assert.equal(dead.knockTime, 0);
  for (let i = 0; i < 8; i++) moveBody(target, { x: 0, y: 0 }, 0.05);
  assert.ok(target.x <= 1102);
  assert.equal(target.hp, 3);
  const room = playingRoom();
  room.members.get("a").state.shockwave = true;
  room.phase = "results";
  assert.equal(room.command("a", { type: "shockwave" }), false);
});

test("three rematches reset abilities, pickups, scores and authoritative placements", () => {
  const room = playingRoom();
  for (let round = 0; round < 3; round++) {
    const a = room.members.get("a").state,
      b = room.members.get("b").state;
    a.shield = true;
    a.dashCooldown = 2;
    a.perfects = 3;
    b.hp = 0;
    b.eliminatedAt = room.time;
    room.tick(0.05);
    assert.equal(room.phase, "results");
    assert.equal(a.placement, 1);
    assert.equal(b.placement, 2);
    assert.equal(room.command("b", { type: "rematch" }), false);
    assert.equal(room.command("a", { type: "rematch" }), true);
    assert.equal(room.command("a", { type: "rematch" }), false);
    room.command("a", { type: "ready", ready: true });
    room.command("b", { type: "ready", ready: true });
    room.command("a", { type: "start" });
    room.tick(3.01);
    assert.equal(room.phase, "playing");
    assert.equal(a.shield, false);
    assert.equal(a.dashCooldown, 0);
    assert.equal(a.perfects, 0);
    assert.equal(a.placement, 0);
    assert.equal(room.pickups.items.length, 0);
  }
});

test("server-selected patterns, modifiers and directions serialize identically for RU and EN clients", () => {
  function seeded(seed) {
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
    return {
      pick: (a) => a[next() % a.length],
      between: (a, b) => a + (next() % (b - a + 1)),
      shuffle: (a) => a,
    };
  }
  const a = new RuleEngine(seeded(45)),
    b = new RuleEngine(seeded(45));
  const p = { ...createBody(), id: "a", distance: 2 };
  const seen = new Set();
  for (let i = 0; i < 4000; i++) {
    a.update(
      0.05,
      i * 0.05,
      [p],
      () => false,
      () => {},
    );
    b.update(
      0.05,
      i * 0.05,
      [p],
      () => false,
      () => {},
    );
    assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
    seen.add(a.state.direction);
    for (const [id, modifier] of Object.entries(a.state.modifiers))
      assert.equal(validModifier(Number(id), modifier), true);
    if (a.state.ids.length === 2)
      assert.equal(compatible(...a.state.ids), true);
  }
  assert.ok(seen.size >= 3);
  const s = new RuleEngine().state;
  Object.assign(s, { phase: "active", ids: [4], elapsed: 2 });
  assert.equal(isFrozen(s), true);
});
