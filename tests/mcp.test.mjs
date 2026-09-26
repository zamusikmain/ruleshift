import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import * as zod from "zod";
import * as mcpSdk from "@modelcontextprotocol/sdk/server/mcp.js";
import * as transportSdk from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadModule } from "./load.mjs";

const tokens = { reader: "r".repeat(48), operator: "w".repeat(48) };
const globals = {
  Request,
  Response,
  Headers,
  URL,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Error,
  Date,
  crypto: webcrypto,
  setTimeout,
  clearTimeout,
};
const overrides = {
  zod,
  "@modelcontextprotocol/sdk/server/mcp.js": mcpSdk,
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js": transportSdk,
  "cloudflare:workers": {
    DurableObject: class {
      constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
      }
    },
  },
};
const { default: worker, McpControl } = loadModule(
  "../mcp/index",
  globals,
  overrides,
);
const { Room } = loadModule("shared/room");
const { inspectRoom, gameConfig } = loadModule("../worker/observability");

function setup({ writes = true } = {}) {
  const data = new Map();
  let failWrites = false,
    queue = Promise.resolve();
  const access = (target) => ({
    get: async (key) => structuredClone(target.get(key)),
    put: async (key, value) => {
      if (failWrites) throw new Error("SECRET_STORAGE_FAILURE");
      target.set(key, structuredClone(value));
    },
  });
  const ctx = {
    storage: {
      ...access(data),
      transaction(task) {
        const run = queue.then(async () => {
          const copy = new Map(
            [...data].map(([key, value]) => [key, structuredClone(value)]),
          );
          const result = await task(access(copy));
          data.clear();
          for (const [key, value] of copy) data.set(key, value);
          return result;
        });
        queue = run.catch(() => {});
        return run;
      },
    },
  };
  const room = new Room("ABC234");
  room.join("secret-player-id", "RECONNECT_SECRET", "PrivateName", 0);
  room.join("second-secret-id", "ANOTHER_SECRET", "OtherName", 1);
  const keys = Object.entries(tokens).map(([role, token]) => ({
    id: role,
    role,
    sha256: createHash("sha256").update(token).digest("hex"),
    expiresAt: "2099-01-01T00:00:00.000Z",
  }));
  const env = {
    MCP_KEYS: JSON.stringify(keys),
    MCP_WRITES_ENABLED: String(writes),
    GAME: {
      getStatus: async () => ({
        service: "RULESHIFT",
        protocolVersion: 2,
        globalMatchIndex: false,
      }),
      getConfig: async () => gameConfig(),
      inspect: async (code) =>
        inspectRoom(code === room.code ? room : undefined, false),
    },
  };
  const control = new McpControl(ctx, env);
  env.CONTROL = { idFromName: (value) => value, get: () => control };
  let id = 0;
  const request = (
    body,
    { role = "reader", headers = {}, method = "POST", path = "/mcp" } = {},
  ) =>
    worker.fetch(
      new Request(`https://mcp.example${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${tokens[role]}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-11-25",
          ...headers,
        },
        ...(method === "POST"
          ? { body: typeof body === "string" ? body : JSON.stringify(body) }
          : {}),
      }),
      env,
    );
  const rpc = async (method, params = {}, options) => {
    const response = await request(
      { jsonrpc: "2.0", id: ++id, method, params },
      options,
    );
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  };
  const call = async (name, args = {}, role = "reader") =>
    (await rpc("tools/call", { name, arguments: args }, { role })).body;
  return {
    env,
    control,
    room,
    request,
    rpc,
    call,
    data,
    failStorage: (value) => {
      failWrites = value;
    },
  };
}

test("real MCP SDK negotiates initialize, notifications, discovery and tool calls via official client", async () => {
  const h = setup();
  const client = new Client({
    name: "ruleshift-integration-test",
    version: "1",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL("https://mcp.example/mcp"),
    {
      requestInit: { headers: { Authorization: `Bearer ${tokens.reader}` } },
      fetch: async (url, init) => worker.fetch(new Request(url, init), h.env),
    },
  );
  await client.connect(transport);
  assert.equal(client.getServerVersion().name, "ruleshift");
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 6);
  assert.ok(
    tools.tools.every((tool) => tool.annotations.readOnlyHint === true),
  );
  const result = await client.callTool({
    name: "get_game_status",
    arguments: {},
  });
  assert.equal(result.structuredContent.service, "RULESHIFT");
  await client.close();
});

test("discovery separates reader/operator and write feature gate; forged calls cannot write", async () => {
  const h = setup();
  assert.equal(
    (await h.rpc("tools/list", {}, { role: "operator" })).body.result.tools
      .length,
    8,
  );
  const denied = await h.call("watch_room", {
    roomCode: "ABC234",
    expectedRevision: 0,
  });
  assert.ok(denied.error || denied.result.isError);
  assert.equal((await h.control.monitoring()).rooms.length, 0);
  const disabled = setup({ writes: false });
  assert.equal(
    (await disabled.rpc("tools/list", {}, { role: "operator" })).body.result
      .tools.length,
    6,
  );
  await assert.rejects(
    disabled.control.change(
      { id: "operator", role: "operator" },
      "watch_room",
      { roomCode: "ABC234", expectedRevision: 0 },
    ),
    /forbidden/,
  );
});

test("all read tools return real scoped data and no identities, tokens or environment", async () => {
  const h = setup();
  const config = await h.call("get_game_config");
  assert.equal(config.result.structuredContent.config.dashCooldownSeconds, 3);
  assert.equal(config.result.structuredContent.config.rules.length, 10);
  assert.equal(
    (await h.call("get_active_matches")).result.structuredContent.matches
      .length,
    0,
  );
  const watched = await h.call(
    "watch_room",
    { roomCode: "ABC234", expectedRevision: 0 },
    "operator",
  );
  assert.equal(watched.result.structuredContent.revision, 1);
  h.room.command("secret-player-id", { type: "ready", ready: true });
  h.room.command("second-secret-id", { type: "ready", ready: true });
  h.room.command("secret-player-id", { type: "start" });
  h.room.tick(3.1);
  const details = await h.call("get_match_details", {
    roomCode: "ABC234",
    expectedMatchId: 1,
  });
  assert.equal(details.result.structuredContent.phase, "playing");
  assert.equal(details.result.structuredContent.players.total, 2);
  const active = await h.call("get_active_matches");
  assert.equal(active.result.structuredContent.matches.length, 1);
  assert.equal(active.result.structuredContent.scope, "monitored_rooms_only");
  const stats = await h.call("get_server_stats");
  assert.equal(stats.result.structuredContent.connectedPlayers, 2);
  assert.equal(stats.result.structuredContent.historicalTotalsAvailable, false);
  const events = await h.call("get_recent_events", { limit: 10 });
  assert.equal(events.result.structuredContent.scope, "mcp_audit_only");
  assert.ok(
    events.result.structuredContent.events.some(
      (event) => event.action === "watch_room" && event.outcome === "success",
    ),
  );
  const serialized = JSON.stringify([config, details, active, stats, events]);
  for (const secret of [
    "PrivateName",
    "OtherName",
    "secret-player-id",
    "RECONNECT_SECRET",
    "ANOTHER_SECRET",
    tokens.reader,
    tokens.operator,
    "MCP_KEYS",
  ])
    assert.ok(!serialized.includes(secret), secret);
});

test("write operations validate room existence, expected revision and persist an atomic audit", async () => {
  const h = setup();
  const before = JSON.stringify(h.room.snapshot());
  const missing = await h.call(
    "watch_room",
    { roomCode: "ZZZ234", expectedRevision: 0 },
    "operator",
  );
  assert.equal(missing.result.isError, true);
  await h.call(
    "watch_room",
    { roomCode: "ABC234", expectedRevision: 0 },
    "operator",
  );
  const conflict = await h.call(
    "unwatch_room",
    { roomCode: "ABC234", expectedRevision: 0 },
    "operator",
  );
  assert.equal(conflict.result.isError, true);
  const removed = await h.call(
    "unwatch_room",
    { roomCode: "ABC234", expectedRevision: 1 },
    "operator",
  );
  assert.equal(removed.result.structuredContent.revision, 2);
  assert.equal(removed.result.structuredContent.rooms.length, 0);
  assert.equal(
    JSON.stringify(h.room.snapshot()),
    before,
    "monitoring must never alter gameplay",
  );
  const audit = await h.control.recent(100);
  assert.ok(audit.events.some((event) => event.outcome === "conflict"));
  assert.ok(
    !JSON.stringify(audit).includes("ABC234"),
    "audit must not retain room invite codes",
  );
});

test("input validation rejects extra fields, invalid codes, bounds, unknown tools and mismatched match IDs", async () => {
  const h = setup();
  for (const [name, args, role] of [
    ["get_game_config", { secret: "MCP_KEYS" }, "reader"],
    ["get_recent_events", { limit: 101 }, "reader"],
    ["get_match_details", { roomCode: "../../storage" }, "reader"],
    ["watch_room", { roomCode: "ABC234", expectedRevision: -1 }, "operator"],
    [
      "watch_room",
      { roomCode: "ABC234", expectedRevision: 0, role: "operator" },
      "operator",
    ],
    ["execute_code", { code: "process.env" }, "operator"],
  ]) {
    const response = await h.call(name, args, role);
    assert.ok(response.error || response.result.isError, name);
  }
  assert.equal(
    (await h.call("get_match_details", { roomCode: "ABC234" })).result.isError,
    true,
  );
  await h.call(
    "watch_room",
    { roomCode: "ABC234", expectedRevision: 0 },
    "operator",
  );
  assert.equal(
    (
      await h.call("get_match_details", {
        roomCode: "ABC234",
        expectedMatchId: 99,
      })
    ).result.content[0].text,
    "match_changed",
  );
});

test("auth fails closed for missing, invalid, expired, ambiguous and unconfigured credentials", async () => {
  const h = setup();
  for (const header of [
    "",
    "Bearer wrong",
    `Bearer ${"x".repeat(48)}`,
    `Basic ${tokens.reader}`,
  ])
    assert.equal(
      (await h.request({}, { headers: { Authorization: header } })).status,
      401,
    );
  const keys = JSON.parse(h.env.MCP_KEYS);
  keys[0].expiresAt = "2020-01-01T00:00:00.000Z";
  h.env.MCP_KEYS = JSON.stringify(keys);
  assert.equal((await h.request({})).status, 401);
  h.env.MCP_KEYS = JSON.stringify([keys[1], keys[1]]);
  assert.equal((await h.request({})).status, 503);
  delete h.env.MCP_KEYS;
  assert.equal((await h.request({})).status, 503);
});

test("HTTP transport rejects bad origins, malformed JSON, batch, huge streamed body and unsupported versions", async () => {
  const h = setup();
  assert.equal(
    (await h.request({}, { headers: { Origin: "https://evil.example" } }))
      .status,
    403,
  );
  h.env.MCP_ALLOWED_ORIGINS = '["https://inspector.example"]';
  const allowed = await h.request(
    {},
    { method: "OPTIONS", headers: { Origin: "https://inspector.example" } },
  );
  assert.equal(allowed.status, 204);
  assert.equal(
    allowed.headers.get("Access-Control-Allow-Origin"),
    "https://inspector.example",
  );
  assert.equal((await h.request("{broken")).status, 400);
  assert.equal((await h.request([])).status, 400);
  assert.equal((await h.request(" ".repeat(17000))).status, 413);
  assert.equal(
    (await h.request({}, { headers: { "Content-Type": "text/plain" } })).status,
    415,
  );
  assert.equal(
    (
      await h.rpc(
        "tools/list",
        {},
        { headers: { "MCP-Protocol-Version": "1900-01-01" } },
      )
    ).status,
    400,
  );
  for (const method of ["GET", "DELETE"])
    assert.equal((await h.request({}, { method })).status, 405);
  assert.equal((await h.request({}, { path: "/admin" })).status, 404);
});

test("backend and storage failures are sanitized; writes fail closed when audit cannot persist", async () => {
  const h = setup();
  h.env.GAME.getStatus = async () => {
    throw new Error("SECRET_CLOUDFLARE_CREDENTIALS");
  };
  const reply = await h.call("get_game_status");
  assert.equal(reply.result.isError, true);
  assert.ok(!JSON.stringify(reply).includes("SECRET"));
  h.failStorage(true);
  assert.equal(
    (
      await h.rpc(
        "tools/call",
        {
          name: "watch_room",
          arguments: { roomCode: "ABC234", expectedRevision: 0 },
        },
        { role: "operator" },
      )
    ).status,
    503,
  );
  assert.equal((await h.control.monitoring()).rooms.length, 0);
  await assert.rejects(
    h.control.change({ id: "operator", role: "operator" }, "watch_room", {
      roomCode: "ABC234",
      expectedRevision: 0,
    }),
  );
  h.failStorage(false);
  assert.equal((await h.control.monitoring()).revision, 0);
  h.env.CONTROL.get = () => { throw new Error("SECRET_BINDING_FAILURE"); };
  const unavailable = await h.rpc("tools/list");
  assert.equal(unavailable.status, 503);
  assert.ok(!JSON.stringify(unavailable.body).includes("SECRET"));
});

test("concurrent writes use compare-and-set, monitoring/audit are bounded and rate limit is shared", async () => {
  const h = setup(),
    actor = { id: "operator", role: "operator" };
  const outcomes = await Promise.allSettled([
    h.control.change(actor, "watch_room", {
      roomCode: "ABC234",
      expectedRevision: 0,
    }),
    h.control.change(actor, "watch_room", {
      roomCode: "BBC234",
      expectedRevision: 0,
    }),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  for (let i = 1; i < 20; i++)
    await h.control.change(actor, "watch_room", {
      roomCode: `${"ABCDEFGHJKLMNPQRSTUVWXYZ"[i]}ZZ234`,
      expectedRevision: i,
    });
  await assert.rejects(
    h.control.change(actor, "watch_room", {
      roomCode: "ZZZ999",
      expectedRevision: 20,
    }),
    /monitor_limit/,
  );
  for (let i = 0; i < 110; i++)
    await h.control.audit({
      actor,
      action: "get_game_status",
      outcome: "success",
    });
  assert.equal((await h.control.recent(100)).events.length, 100);
  for (let i = 0; i < 60; i++)
    assert.equal(await h.control.consumeRate(actor), true);
  assert.equal(await h.control.consumeRate(actor), false);
  const limited = await h.rpc("tools/list", {}, { role: "operator" });
  assert.equal(limited.status, 429);
});

test("read projection handles missing, reset and expired rooms without mutating simulation", () => {
  assert.equal(inspectRoom(undefined, false).reason, "not_found");
  assert.equal(inspectRoom(undefined, true).reason, "reset");
  const room = new Room("ABC234");
  room.clock = 901;
  assert.equal(inspectRoom(room, true).reason, "expired");
  room.clock = 0;
  const before = JSON.stringify(room.snapshot());
  inspectRoom(room, true);
  assert.equal(JSON.stringify(room.snapshot()), before);
});
