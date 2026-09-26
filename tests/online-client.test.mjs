import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load.mjs";

test("Results retain their action nodes across snapshots; rematch and leave work across three cycles", () => {
  const nodes = new Map();
  let renders = 0,
    exits = 0,
    active = false;
  const bodyClasses = new Set();
  const document = {
    hidden: false,
    body: {
      classList: {
        add: (...s) => s.forEach((v) => bodyClasses.add(v)),
        remove: (...s) => s.forEach((v) => bodyClasses.delete(v)),
      },
    },
    querySelector: (selector) => {
      if (!nodes.has(selector))
        nodes.set(selector, { hidden: true, setAttribute() {} });
      return nodes.get(selector);
    },
  };
  const callbacks = new Map();
  const ui = {
    panel(title, html) {
      renders++;
      callbacks.clear();
      bodyClasses.delete("playing");
      assert.ok(!html.includes("undefined"));
    },
    button: (id) => `<button id="${id}"></button>`,
    bind: (id, fn) => callbacks.set(id, fn),
    clearMenu() {
      callbacks.clear();
    },
    escapeHtml: (s) => s,
    colorHex: () => "#ffffff",
    notifyAchievements() {},
    toast() {},
  };
  const { OnlineClient } = loadModule(
    "online/client",
    { document, clearTimeout() {}, clearInterval() {}, WebSocket: { OPEN: 1 } },
    {
      phaser: {},
      "../ui": ui,
      "../featureView": {
        FeatureView: class {
          hide() {}
          reset() {}
          destroy() {}
        },
        showAbilities() {},
      },
      "../ruleView": {
        RuleView: class {
          draw() {}
        },
        ruleTitle: () => "rule",
        ruleSubtitle: () => "description",
      },
      "../audio": { audio: { play() {} } },
      "../device": { isPortraitTouch: () => false, updateOrientation() {} },
      "../hud": { hideHud() {} },
    },
  );
  const controls = {
    setEnabled(value) {
      active = value;
    },
    reset() {},
  };
  const client = new OnlineClient(
    {},
    controls,
    () => exits++,
    () => {},
  );
  const { Room } = loadModule("shared/room");
  const room = new Room("ABC234");
  room.join("a", "token-a", "Alpha", 0);
  room.join("b", "token-b", "Beta", 1);
  client.id = "a";
  const sent = [];
  client.socket = {
    readyState: 1,
    send(raw) {
      const message = JSON.parse(raw);
      sent.push(message);
      room.command("a", message);
    },
    close() {},
  };
  for (let round = 0; round < 3; round++) {
    room.command("a", { type: "ready", ready: true });
    room.command("b", { type: "ready", ready: true });
    room.command("a", { type: "start" });
    room.tick(3.1);
    client.receive(room.snapshot());
    assert.equal(active, true);
    room.members.get("b").state.hp = 0;
    room.members.get("b").state.eliminatedAt = room.time;
    room.tick(0.05);
    client.receive(room.snapshot());
    assert.equal(active, false);
    const action = callbacks.get("rematch"),
      count = renders;
    for (let i = 0; i < 20; i++) client.receive(room.snapshot());
    assert.equal(
      renders,
      count,
      "network snapshots must not replace a button between touch down/up",
    );
    assert.equal(callbacks.get("rematch"), action);
    action();
    assert.equal(room.phase, "lobby");
    client.receive(room.snapshot());
  }
  assert.equal(sent.filter((message) => message.type === "rematch").length, 3);
  callbacks.get("leave")();
  assert.equal(exits, 1);
  assert.equal(active, false);
});
