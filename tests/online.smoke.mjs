// Integration smoke test for an actual local Wrangler server, never production.
import assert from "node:assert/strict";
const base = new URL(process.env.RULESHIFT_TEST_URL ?? "http://127.0.0.1:8787");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
  throw Error("Only a localhost server may be tested.");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw Error(message);
    await pause(30);
  }
}
const clients = [];
async function connect(code, name, token) {
  const url = new URL(`/api/rooms/${code}`, base);
  url.protocol = "ws:";
  const socket = new WebSocket(url),
    client = { socket, state: null, welcome: null, error: null };
  clients.push(client);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") client.state = message;
    if (message.type === "welcome") client.welcome = message;
    if (message.type === "error") client.error = message.code;
  });
  await waitFor(
    () => socket.readyState === WebSocket.OPEN,
    "WebSocket did not open",
  );
  client.send = (message) => socket.send(JSON.stringify(message));
  client.send({ type: "hello", name, color: 0, ...(token ? { token } : {}) });
  await waitFor(() => client.welcome || client.error, "No handshake response");
  return client;
}
try {
  const response = await fetch(new URL("/api/rooms", base), {
    method: "POST",
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(response.status, 201);
  const { code } = await response.json();
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  const a = await connect(code, "Smoke One"),
    b = await connect(code, "Smoke Два");
  await waitFor(
    () => a.state?.players.length === 2 && b.state?.players.length === 2,
    "Lobby not synchronized",
  );
  assert.notEqual(a.state.players[0].color, a.state.players[1].color);
  b.send({ type: "start" });
  await pause(100);
  assert.equal(b.state.phase, "lobby");
  a.send({ type: "ready", ready: true });
  b.send({ type: "ready", ready: true });
  await waitFor(
    () => a.state.players.every((p) => p.ready),
    "Readiness not synchronized",
  );
  a.send({ type: "start" });
  await waitFor(
    () => a.state.phase === "playing" && b.state.phase === "playing",
    "Match failed to start",
  );
  const start = a.state.players.find((p) => p.id === a.welcome.id).x;
  for (let i = 0; i < 5; i++) {
    a.send({ type: "input", x: 1, y: 0 });
    await pause(50);
  }
  assert.ok(a.state.players.find((p) => p.id === a.welcome.id).x > start);
  b.socket.close();
  await pause(200);
  const reconnected = await connect(code, "Smoke Два", b.welcome.token);
  assert.equal(reconnected.welcome.id, b.welcome.id);
  reconnected.send({ type: "leave" });
  await waitFor(
    () => a.state.phase === "results",
    "No result after last opponent left",
  );
  assert.equal(a.state.winnerId, a.welcome.id);
  a.send({ type: "rematch" });
  await waitFor(
    () => a.state.phase === "lobby",
    "Rematch did not return to lobby",
  );
  console.log(
    "PASS: real local HTTP/WebSocket create, join, colors, readiness, authority, movement, reconnect, winner and rematch.",
  );
} finally {
  clients.forEach((client) => client.socket.close());
}
