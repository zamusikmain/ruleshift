import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "./load.mjs";
const identity = loadModule("shared/identity");
const profiles = loadModule("profile");
const locales = loadModule("locales/index");
const movement = loadModule("shared/movement");
const { Scoring } = loadModule("shared/scoring");
const { RuleEngine, RULE_DEFS, COMPATIBLE_PAIRS, compatible } =
  loadModule("shared/ruleEngine");
const { parseClientMessage } = loadModule("shared/protocol");
const { Room, RECONNECT_GRACE } = loadModule("shared/room");
const plain = (value) => JSON.parse(JSON.stringify(value));
test("locales have identical keys and respect saved preference", () => {
  const { en } = loadModule("locales/en"),
    { ru } = loadModule("locales/ru");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  assert.equal(locales.detectLocale(null, "ru-RU"), "ru");
  assert.equal(locales.detectLocale("en", "ru"), "en");
  assert.equal(locales.detectLocale(null, "fr"), "en");
  locales.setLocale("ru");
  assert.equal(locales.t("gameOver"), "ИГРА ОКОНЧЕНА");
  assert.ok(locales.t("colorMatchDesc", { symbol: "II" }).includes("II"));
  locales.setLocale("en");
});
test("names support Cyrillic, reject markup, controls and invalid lengths", () => {
  assert.equal(identity.validateName("  Замир-12  "), "Замир-12");
  assert.equal(identity.validateName("Player_01"), "Player_01");
  for (const name of [
    "",
    "ab",
    "a".repeat(17),
    "<img src=x>",
    "abc\n",
    "ab\ncd",
    "a\u202ebcd",
    "abc\u0000",
    "😀😀😀",
  ])
    assert.equal(identity.validateName(name), null);
  for (const color of [-1, 8, "red", 1.5, null])
    assert.equal(identity.validColor(color), false);
});
test("profile migration, roundtrip and corrupt storage fallback", () => {
  const values = new Map([["ruleshift.best", "500"]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const profile = profiles.loadProfile(storage);
  assert.equal(profile.stats.best, 500);
  profile.name = "Игрок";
  profile.color = 3;
  profile.stats.wins = 2;
  profiles.persistProfile(profile, storage);
  assert.deepEqual(plain(profiles.loadProfile(storage)), plain(profile));
  storage.setItem("ruleshift.profile.v1", "{broken");
  assert.equal(profiles.loadProfile(storage).name, "");
  const failing = {
    getItem() {
      throw Error("disabled");
    },
    setItem() {
      throw Error("disabled");
    },
  };
  assert.doesNotThrow(() => profiles.persistProfile(profile, failing));
});
test("movement: normalized diagonals, analog input, boundary and damage cooldown", () => {
  assert.equal(movement.normalizeInput(0.05, 0.05, 0.16).x, 0);
  assert.ok(
    Math.hypot(...Object.values(movement.normalizeInput(1, 1))) <= 1.000001,
  );
  const body = movement.createBody();
  for (let i = 0; i < 200; i++) movement.moveBody(body, { x: 1, y: 1 }, 0.05);
  assert.equal(body.x, 1102);
  assert.equal(body.y, 642);
  assert.equal(body.distance, 0);
  assert.equal(movement.damageBody(body), true);
  assert.equal(movement.damageBody(body), false);
  assert.equal(body.hp, 2);
  for (let i = 0; i < 21; i++) movement.moveBody(body, { x: 0, y: 0 }, 0.05);
  assert.equal(movement.damageBody(body), true);
});
test("scoring multiplier is capped, damage resets it, achievements unlock once", () => {
  const scoring = new Scoring();
  assert.equal(scoring.complete(), 100);
  assert.equal(scoring.complete(2), 400);
  for (let i = 0; i < 6; i++) scoring.complete();
  assert.equal(scoring.complete(), 500);
  scoring.fail();
  assert.equal(scoring.complete(), 100);
  const p = profiles.loadProfile();
  Object.assign(p.stats, {
    longest: 65,
    flawless: 32,
    wins: 1,
    chaos: 1,
    soloGames: 10,
    rules: 50,
    streak: 5,
  });
  assert.equal(profiles.unlockAchievements(p).length, 8);
  assert.equal(profiles.unlockAchievements(p).length, 0);
});
test("ten rules, explicit compatibility and no early Chaos", () => {
  assert.equal(RULE_DEFS.length, 10);
  assert.equal(compatible(0, 4), false);
  for (const [a, b] of COMPATIBLE_PAIRS) {
    assert.equal(compatible(a, b), true);
    assert.equal(compatible(b, a), true);
  }
  const random = {
    pick: (values) => values[0],
    between: (min) => min,
    shuffle: (values) => values,
  };
  const engine = new RuleEngine(random);
  engine.update(
    3,
    0,
    [],
    () => {},
    () => {},
  );
  assert.equal(engine.state.ids.length, 1);
  const late = new RuleEngine(random);
  late.update(
    3,
    100,
    [],
    () => {},
    () => {},
  );
  assert.equal(late.state.ids.length, 2);
  assert.equal(compatible(...late.state.ids), true);
});
test("new rules give warning time and clean up hazards", () => {
  for (let id = 5; id < 10; id++) {
    const random = {
      pick: (values) => (values.includes(id) ? id : values[0]),
      between: (min) => min,
      shuffle: (values) => values,
    };
    const engine = new RuleEngine(random),
      player = { ...movement.createBody(580, 399), id: "p" };
    let hits = 0;
    while (engine.state.phase !== "active")
      engine.update(
        0.01,
        0,
        [player],
        () => hits++,
        () => {},
      );
    for (let i = 0; i < 100; i++)
      engine.update(
        0.01,
        0,
        [player],
        () => hits++,
        () => {},
      );
    assert.equal(hits, 0, `rule ${id} warning`);
    while (engine.state.phase === "active")
      engine.update(
        0.01,
        0,
        [player],
        () => hits++,
        () => {},
      );
    assert.equal(engine.state.hazards.length, 0);
  }
});
test("room codes and strict protocol reject impossible/untrusted state", () => {
  assert.equal(
    identity.validRoomCode(
      identity.createRoomCode(new Uint8Array([0, 1, 2, 3, 4, 5])),
    ),
    true,
  );
  assert.equal(identity.validRoomCode("../api"), false);
  for (const message of [
    { type: "winner" },
    { type: "input", x: 100, y: 0 },
    { type: "input", x: 1, y: 1 },
    { type: "input", x: 0, y: 0, hp: 3 },
    { type: "hello", name: "<script>", color: 0 },
    { type: "ready", ready: "true" },
  ])
    assert.equal(parseClientMessage(JSON.stringify(message)), null);
  assert.equal(parseClientMessage("{"), null);
  assert.equal(parseClientMessage("x".repeat(513)), null);
  assert.equal(
    parseClientMessage('{"type":"input","x":0.5,"y":0.5}').type,
    "input",
  );
});
test("new hazards damage at the correct location; matching symbol succeeds", () => {
  function run(id, x, y, seconds) {
    const random = {
      pick: (values) => (values.includes(id) ? id : values[0]),
      between: (min) => min,
      shuffle: (values) => values,
    };
    const engine = new RuleEngine(random),
      player = { ...movement.createBody(x, y), id: "p" };
    let hits = 0,
      rewards = 0;
    while (engine.state.phase !== "active")
      engine.update(
        0.01,
        0,
        [player],
        () => hits++,
        () => rewards++,
      );
    for (let i = 0; i < seconds * 100; i++)
      engine.update(
        0.01,
        0,
        [player],
        () => hits++,
        () => rewards++,
      );
    return { hits, rewards };
  }
  assert.ok(run(5, 580, 180, 1.65).hits > 0);
  assert.equal(run(5, 65, 180, 6.1).hits, 0);
  assert.ok(run(6, 58, 399, 2).hits > 0);
  assert.equal(run(6, 580, 399, 6.1).hits, 0);
  assert.ok(run(7, 580, 399, 6.1).hits > 0);
  assert.equal(run(8, 580, 399, 1.3).hits, 0);
  assert.ok(run(8, 580, 399, 1.6).hits > 0);
  assert.equal(run(9, 340, 399, 6.1).rewards, 1);
  assert.equal(run(9, 820, 399, 6.1).hits, 1);
});
function roomWithPlayers(count = 2) {
  const room = new Room("ABC234");
  for (let i = 0; i < count; i++) {
    room.join(`p${i}`, `token${i}`, "Same Name", 0);
    room.command(`p${i}`, { type: "ready", ready: true });
  }
  return room;
}
test("room capacity, unique colors, host transfer and readiness requirements", () => {
  const room = roomWithPlayers(8);
  assert.equal(new Set(room.snapshot().players.map((p) => p.color)).size, 8);
  assert.equal(room.join("extra", "x", "Extra", 0), "roomFull");
  assert.equal(room.command("p1", { type: "start" }), false);
  room.command("p2", { type: "ready", ready: false });
  assert.equal(room.command("p0", { type: "start" }), false);
  room.remove("p0");
  assert.equal(room.hostId, "p1");
  assert.equal(room.members.size, 7);
});
test("countdown, authoritative movement, elimination, winner and rematch", () => {
  const room = roomWithPlayers();
  assert.equal(room.command("p0", { type: "start" }), true);
  assert.equal(room.phase, "countdown");
  assert.equal(room.join("x", "x", "Extra", 1), "matchStarted");
  for (let i = 0; i < 61; i++) room.tick(0.05);
  assert.equal(room.phase, "playing");
  const before = room.members.get("p0").state.x;
  room.command("p0", { type: "input", x: 1, y: 0 });
  room.tick(0.05);
  assert.ok(room.members.get("p0").state.x > before);
  room.members.get("p1").state.hp = 0;
  room.tick(0.05);
  assert.equal(room.phase, "results");
  assert.equal(room.winnerId, "p0");
  assert.equal(room.command("p1", { type: "input", x: 1, y: 0 }), false);
  assert.equal(room.command("p1", { type: "rematch" }), false);
  assert.equal(room.command("p0", { type: "rematch" }), true);
  assert.equal(room.phase, "lobby");
  assert.equal(
    room.snapshot().players.every((p) => !p.ready),
    true,
  );
});
test("simultaneous elimination is a draw; reconnect requires secret and has grace", () => {
  const room = roomWithPlayers();
  room.disconnect("p0");
  assert.equal(typeof room.join("new", "new", "Name", 0, "token0"), "object");
  assert.equal(room.join("new", "new", "Name", 0, "token0"), "connectionLost");
  room.command("p0", { type: "ready", ready: true });
  room.command("p0", { type: "start" });
  for (let i = 0; i < 61; i++) room.tick(0.05);
  room.members.forEach((m) => (m.state.hp = 0));
  room.tick(0.05);
  assert.equal(room.winnerId, null);
  assert.equal(room.phase, "results");
  const expired = roomWithPlayers();
  expired.disconnect("p0");
  expired.tick(RECONNECT_GRACE + 0.1);
  assert.equal(expired.hostId, "p1");
  assert.equal(expired.members.has("p0"), false);
  assert.equal(JSON.stringify(expired.snapshot()).includes("token1"), false);
  const bothLost = roomWithPlayers();
  bothLost.command("p0", { type: "start" });
  for (let i = 0; i < 61; i++) bothLost.tick(0.05);
  bothLost.disconnect("p0");
  bothLost.disconnect("p1");
  bothLost.tick(RECONNECT_GRACE + 0.1);
  assert.equal(bothLost.phase, "results");
  assert.equal(bothLost.winnerId, null);
});
