import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { loadModule } from "./load.mjs";

class FakeSocket extends EventTarget {
  messages = [];
  closed = false;
  accept() {}
  send(text) {
    this.messages.push(JSON.parse(text));
  }
  close() {
    this.closed = true;
  }
  input(message) {
    const event = new Event("message");
    event.data =
      typeof message === "string" ? message : JSON.stringify(message);
    this.dispatchEvent(event);
  }
}
class Pair {
  constructor() {
    this[0] = new FakeSocket();
    this[1] = new FakeSocket();
  }
}
class TestResponse {
  constructor(body, init = {}) {
    this.body = body;
    Object.assign(this, init);
    this.status = init.status ?? 200;
    this.ok = this.status < 400;
  }
  static json(value, init) {
    return new TestResponse(JSON.stringify(value), init);
  }
  async json() {
    return JSON.parse(this.body);
  }
}
function setup() {
  const rooms = new Map();
  const { default: worker, GameRoom } = loadModule(
    "../worker/index",
    {
      Request,
      Response: TestResponse,
      URL,
      crypto: webcrypto,
      WebSocketPair: Pair,
      setInterval: () => 1,
      clearInterval: () => {},
    },
    {
      "cloudflare:workers": {
        DurableObject: class {
          constructor(ctx, env) {
            this.ctx = ctx;
            this.env = env;
          }
        },
      },
    },
  );
  const env = {
    ASSETS: { fetch: () => new TestResponse("asset") },
    ROOMS: {
      idFromName: (name) => name,
      get: (name) => {
        if (!rooms.has(name)) {
          const data = new Map();
          let ready;
          const ctx = {
            blockConcurrencyWhile: (task) => {
              ready = task();
            },
            storage: {
              get: async (key) => data.get(key),
              put: async (key, value) => data.set(key, value),
              setAlarm: async () => {},
              deleteAlarm: async () => {},
              deleteAll: async () => data.clear(),
            },
          };
          const object = new GameRoom(ctx, env);
          rooms.set(name, {
            object,
            fetch: async (request) => {
              await ready;
              return object.fetch(request);
            },
          });
        }
        return rooms.get(name);
      },
    },
  };
  const fetch = (path, init) =>
    worker.fetch(new Request(`http://localhost${path}`, init), env);
  return { rooms, fetch };
}
test("Worker routes assets, validates Origin/codes, creates room and upgrades sockets", async () => {
  const h = setup();
  assert.equal((await h.fetch("/")).body, "asset");
  assert.equal(
    (
      await h.fetch("/api/rooms", {
        method: "POST",
        headers: { Origin: "https://other.example" },
      })
    ).status,
    403,
  );
  assert.equal((await h.fetch("/api/rooms/WRONG")).status, 404);
  const response = await h.fetch("/api/rooms", { method: "POST" });
  assert.equal(response.status, 201);
  const { code } = await response.json();
  const object = h.rooms.get(code).object;
  const connect = async (name) => {
    const response = await h.fetch(`/api/rooms/${code}`, {
      headers: { Upgrade: "websocket" },
    });
    assert.equal(response.status, 101);
    const socket = [...object.sessions.keys()].at(-1);
    socket.input({ type: "hello", protocol: 2, name, color: 0 });
    return socket;
  };
  const a = await connect("Замир"),
    b = await connect("Player");
  assert.equal(a.messages[0].type, "welcome");
  assert.equal(b.messages[0].type, "welcome");
  a.input({ type: "ready", ready: true });
  b.input({ type: "ready", ready: true });
  a.input({ type: "start" });
  assert.equal(object.room.phase, "countdown");
  for (let i = 0; i < 61; i++) object.room.tick(0.05);
  a.input({ type: "input", x: 0.5, y: 0.5 });
  object.room.tick(0.05);
  object.broadcast();
  const state = a.messages.at(-1);
  assert.equal(state.type, "state");
  assert.equal(state.players.length, 2);
  assert.equal(state.phase, "playing");
  assert.equal(JSON.stringify(state).includes(a.messages[0].token), false);
  const hp = state.players[0].hp;
  a.input({ type: "input", x: 0, y: 0, hp: 999 });
  assert.equal(a.closed, true);
  assert.equal(object.room.snapshot().players[0].hp, hp);
});
test("Worker socket rate and handshake limits reject abuse", async () => {
  const h = setup(),
    { code } = await (await h.fetch("/api/rooms", { method: "POST" })).json();
  const object = h.rooms.get(code).object;
  await h.fetch(`/api/rooms/${code}`, { headers: { Upgrade: "websocket" } });
  const socket = [...object.sessions.keys()][0];
  socket.input({ type: "hello", protocol: 2, name: "Tester", color: 0 });
  for (let i = 0; i < 71; i++) socket.input({ type: "ping" });
  assert.equal(socket.closed, true);
  assert.equal(
    socket.messages.some((m) => m.code === "rateLimit"),
    true,
  );
});
