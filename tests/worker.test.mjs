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
  const {
    default: worker,
    GameRoom,
    GameInspection,
  } = loadModule(
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
        WorkerEntrypoint: class {
          constructor(ctx, env) {
            this.ctx = ctx;
            this.env = env;
          }
        },
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
            inspect: async () => {
              await ready;
              return object.inspect();
            },
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
  return { rooms, fetch, inspection: new GameInspection({}, env) };
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
    socket.input({ type: "hello", protocol: 8, name, color: 0 });
    return socket;
  };
  const a = await connect("Замир"),
    b = await connect("Player");
  await h.fetch(`/api/rooms/${code}`, { headers: { Upgrade: "websocket" } });
  const legacy = [...object.sessions.keys()].at(-1);
  legacy.input({ type: "hello", protocol: 7, name: "Legacy", color: 0 });
  assert.equal(legacy.closed, true);
  assert.equal(legacy.messages.at(-1).code, "versionMismatch");
  assert.equal(object.room.members.size, 2);
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
  socket.input({ type: "hello", protocol: 8, name: "Tester", color: 0 });
  for (let i = 0; i < 71; i++) socket.input({ type: "ping" });
  assert.equal(socket.closed, true);
  assert.equal(
    socket.messages.some((m) => m.code === "rateLimit"),
    true,
  );
});
test('public gateway strips spoofed internal account and session headers',async()=>{
 const h=setup(),{code}=await(await h.fetch('/api/rooms',{method:'POST'})).json();
 await h.fetch(`/api/rooms/${code}`,{headers:{Upgrade:'websocket','X-Ruleshift-Account':webcrypto.randomUUID(),'X-Ruleshift-Session':'a'.repeat(64),'X-Ruleshift-Name':'Spoofed'}});
 const object=h.rooms.get(code).object,session=[...object.sessions.values()][0];
 assert.equal(session.accountId,undefined);assert.equal(session.sessionHash,undefined);assert.equal(session.accountName,undefined);
});
test("Worker sends the authoritative forfeiture snapshot before closing a departing player",async()=>{
  const h=setup(),{code}=await(await h.fetch("/api/rooms",{method:"POST"})).json();
  const object=h.rooms.get(code).object,sockets=[];
  for(let i=0;i<3;i++) {
    await h.fetch(`/api/rooms/${code}`,{headers:{Upgrade:"websocket"}});
    const socket=[...object.sessions.keys()].at(-1);sockets.push(socket);
    socket.input({type:"hello",protocol:8,name:`Player${i}`,color:i});
    socket.input({type:"ready",ready:true});
  }
  sockets[0].input({type:"start"});object.room.tick(3.1);object.room.time=30;
  const departing=sockets[0],id=departing.messages[0].id;
  departing.input({type:"leave"});
  assert.equal(departing.closed,true);
  const ack=departing.messages.at(-1);
  assert.equal(ack.type,"state");assert.equal(ack.players.find(p=>p.id===id).forfeited,true);
  assert.equal(JSON.stringify(ack).includes(departing.messages[0].token),false);
});

test("private inspection entrypoint reads existing rooms without exposing an HTTP admin route or changing state", async () => {
  const h = setup();
  assert.equal((await h.inspection.getStatus()).service, "RULESHIFT");
  assert.equal((await h.inspection.getConfig()).mutableThroughMcp, false);
  await assert.rejects(
    h.inspection.inspect("../../storage"),
    /invalid_room_code/,
  );
  assert.equal((await h.inspection.inspect("ZZZ234")).reason, "not_found");
  const { code } = await (
    await h.fetch("/api/rooms", { method: "POST" })
  ).json();
  const room = h.rooms.get(code).object.room;
  room.join("private-id", "private-token", "PrivatePlayer", 0);
  const before = JSON.stringify(room.snapshot());
  const details = await h.inspection.inspect(code);
  assert.equal(details.players.total, 1);
  assert.equal(details.phase, "lobby");
  assert.ok(!JSON.stringify(details).includes("private"));
  assert.equal(JSON.stringify(room.snapshot()), before);
  assert.equal((await h.fetch(`/api/rooms/${code}/inspect`)).status, 404);
  assert.equal((await h.fetch("/api/admin")).status, 404);
});

test('trusted account reconnect keeps UUID, nickname, room and active body; another account cannot steal it',async()=>{
 const h=setup(),{code}=await(await h.fetch('/api/rooms',{method:'POST'})).json(),object=h.rooms.get(code).object;
 const account=webcrypto.randomUUID();
 const connect=async(id,name,token)=>{
  await object.fetch(new Request('https://ruleshift.test/api/rooms/'+code,{headers:{Upgrade:'websocket','X-Ruleshift-Account':id,'X-Ruleshift-Name':encodeURIComponent(name),'X-Ruleshift-Session':'test-session'}}));
  const socket=[...object.sessions.keys()].at(-1);socket.input({type:'hello',protocol:8,name:'Client spoof',color:0,...(token?{token}:{})});return socket;
 };
 const a=await connect(account,'Trusted Name'),b=await connect(webcrypto.randomUUID(),'Opponent');
 a.input({type:'ready',ready:true});b.input({type:'ready',ready:true});a.input({type:'start'});object.room.tick(3.1);
 const welcome=a.messages.find(m=>m.type==='welcome'),before=object.room.snapshot();
 a.dispatchEvent(new Event('close'));
 const stolen=await connect(webcrypto.randomUUID(),'Wrong Account',welcome.token);assert.equal(stolen.closed,true);
 const restored=await connect(account,'Trusted Name',welcome.token),next=restored.messages.find(m=>m.type==='welcome');
 assert.equal(next.id,welcome.id);assert.equal(object.principals.get(next.id),account);
 const after=object.room.snapshot(),old=before.players.find(p=>p.id===next.id),current=after.players.find(p=>p.id===next.id);
 assert.equal(after.code,before.code);assert.equal(after.matchId,before.matchId);assert.equal(after.phase,'playing');
 for(const key of ['x','y','hp','score'])assert.equal(current[key],old[key]);assert.equal(current.name,'Trusted Name');assert.equal(current.connected,true);
});
