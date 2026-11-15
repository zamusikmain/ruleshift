import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { gameConfig, inspectRoom } from "./observability";
import { createRoomCode, validRoomCode } from "../src/shared/identity";
import {
  parseClientMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "../src/shared/protocol";
import { Room, ROOM_IDLE_SECONDS } from "../src/shared/room";
import {RoomRankings} from './roomRankings';
interface Env {
  RANKINGS_DB?: D1Database;
  AUTH_ORIGIN?: string;
  AUTH_RP_ID?: string;
  ROOMS: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
}
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const createRates = new Map<string, { count: number; at: number }>();
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/account/') || url.pathname.startsWith('/api/leaderboard')) {
      const {accountApi}=await import('./accountApi');
      return accountApi(request,env);
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin)
      return json({ error: "invalidMessage" }, 403);
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const now = Date.now(),
        ip = request.headers.get("CF-Connecting-IP") ?? "local";
      for (const [key, rate] of createRates)
        if (now - rate.at > 60000) createRates.delete(key);
      const rate = createRates.get(ip) ?? { at: now, count: 0 };
      if (rate.count >= 12 || createRates.size > 4096)
        return json({ error: "rateLimit" }, 429);
      rate.count++;
      createRates.set(ip, rate);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = createRoomCode(crypto.getRandomValues(new Uint8Array(6))),
          stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const response = await stub.fetch(
          new Request(`${url.origin}/initialize?code=${code}`, {
            method: "POST",
          }),
        );
        if (response.ok) return json({ code }, 201);
      }
      return json({ error: "rateLimit" }, 503);
    }
    const match = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname);
    if (!match || !validRoomCode(match[1]) || request.method !== "GET")
      return json({ error: "roomNotFound" }, 404);
    const forwarded=new Request(request);const headers=forwarded.headers;headers.delete('X-Ruleshift-Account');headers.delete('X-Ruleshift-Session');headers.delete('X-Ruleshift-Name');
    if(request.headers.get('Upgrade')?.toLowerCase()==='websocket'&&env.RANKINGS_DB&&env.AUTH_ORIGIN&&env.AUTH_RP_ID){
      if(origin!==env.AUTH_ORIGIN)return json({error:'invalidMessage'},403);
      const {Accounts,hashSecret}=await import('./accounts'),{cookieToken,SESSION_COOKIE}=await import('./accountApi');
      const token=cookieToken(request,SESSION_COOKIE);
      const session=await new Accounts(env.RANKINGS_DB,env.AUTH_ORIGIN,env.AUTH_RP_ID).session(token);
      if(session&&token){headers.set('X-Ruleshift-Name',encodeURIComponent(session.display_name));headers.set('X-Ruleshift-Account',session.id);headers.set('X-Ruleshift-Session',await hashSecret(token));}
    }
    return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;

// Only a same-account Service Binding can reach these RPC methods.
// The default public fetch handler above does not route to this entrypoint.
export class GameInspection extends WorkerEntrypoint<Env> {
  async getStatus() {
    return {
      service: "RULESHIFT",
      protocolVersion: PROTOCOL_VERSION,
      globalMatchIndex: false as const,
    };
  }
  async getConfig() {
    return gameConfig();
  }
  async inspect(code: string) {
    if (!validRoomCode(code)) throw new Error("invalid_room_code");
    return this.env.ROOMS.get(this.env.ROOMS.idFromName(code)).inspect();
  }
}

interface Session {
  accountName?:string;
  accountId?:string;
  sessionHash?:string;
  id?: string;
  joined: boolean;
  window: number;
  count: number;
  lastSeen: number;
}
export class GameRoom extends DurableObject<Env> {
  private room?: Room;
  private sessions = new Map<WebSocket, Session>();
  private timer?: ReturnType<typeof setInterval>;
  private previous = Date.now();
  private accumulator = 0;
  private persistClock = 0;
  private existed = false;
  private principals=new Map<string,string>();
  private rankings?:RoomRankings;
  private sessionCheckedAt=0;
  private queue:Promise<void>=Promise.resolve();
  private enqueue(action:()=>void|Promise<void>):void {if(!this.rankings){void action();return;}this.queue=this.queue.then(action).catch(()=>{for(const socket of this.sessions.keys())socket.close(1011,'storage unavailable');});this.ctx.waitUntil(this.queue);}
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if(env.RANKINGS_DB)this.rankings=new RoomRankings(ctx.storage,env.RANKINGS_DB);
    ctx.blockConcurrencyWhile(async () => {
      this.existed = !!(await ctx.storage.get("exists"));
      await this.rankings?.interrupt();
    });
  }
  async inspect() {
    return inspectRoom(this.room, this.existed);
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/initialize" && request.method === "POST") {
      if (this.room || this.existed) return json({ error: "roomFull" }, 409);
      const code = url.searchParams.get("code");
      if (!validRoomCode(code)) return json({ error: "invalidMessage" }, 400);
      this.room = new Room(code);
      this.existed = true;
      await this.ctx.storage.put("exists", true);
      await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_SECONDS * 1000);
      this.startTimer();
      return json({ code });
    }
    if (!this.room)
      return json({ error: this.existed ? "matchReset" : "roomNotFound" }, 404);
    if (this.room.expired) return json({ error: "roomExpired" }, 410);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return json({
        code: this.room.code,
        phase: this.room.phase,
        players: this.room.members.size,
      });
    if (this.sessions.size >= 12) return json({ error: "roomFull" }, 409);
    const pair = new WebSocketPair(),
      client = pair[0],
      server = pair[1];
    server.accept();
    this.sessions.set(server, {
      accountId:request.headers.get('X-Ruleshift-Account')??undefined,
      accountName:decodeURIComponent(request.headers.get('X-Ruleshift-Name')??'')||undefined,
      sessionHash:request.headers.get('X-Ruleshift-Session')??undefined,
      joined: false,
      window: Date.now(),
      count: 0,
      lastSeen: Date.now(),
    });
    server.addEventListener("message", (event) =>
      this.enqueue(()=>this.message(server, event.data)),
    );
    server.addEventListener("close", () => this.close(server));
    server.addEventListener("error", () => this.close(server));
    this.startTimer();
    return new Response(null, { status: 101, webSocket: client });
  }
  private send(socket: WebSocket, message: ServerMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      this.close(socket);
    }
  }
  private async message(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session || !this.room) return;
    const now = Date.now();
    if (now - session.window >= 1000) {
      session.window = now;
      session.count = 0;
    }
    if (++session.count > 70) {
      this.send(socket, { type: "error", code: "rateLimit" });
      socket.close(1008, "rateLimit");
      this.close(socket);
      return;
    }
    const message = parseClientMessage(raw);
    if (!message) {
      this.send(socket, { type: "error", code: "invalidMessage" });
      socket.close(1008, "invalidMessage");
      this.close(socket);
      return;
    }
    session.lastSeen = now;
    if (message.type === "hello") {
      if (message.protocol !== PROTOCOL_VERSION) {
        this.send(socket, {
          type: "error",
          code:
            message.protocol === undefined ? "matchReset" : "versionMismatch",
        });
        socket.close(1008, "versionMismatch");
        this.close(socket);
        return;
      }
      if (session.joined) {
        socket.close(1008, "invalidMessage");
        this.close(socket);
        return;
      }
      const previous=message.token?[...this.room.members.values()].find(m=>m.token===message.token):undefined;
      if(previous&&this.principals.get(previous.state.id)!==session.accountId){socket.close(1008,'invalidMessage');this.close(socket);return;}
      if(previous&&session.accountName)previous.state.name=session.accountName;
      const result = this.room.join(
        crypto.randomUUID(),
        crypto.randomUUID(),
        session.accountName??message.name,
        message.color,
        message.token,
      );
      if (typeof result === "string") {
        this.send(socket, { type: "error", code: result });
        socket.close(1008, result);
        this.close(socket);
        return;
      }
      session.joined = true;
      session.id = result.id;
      if(session.accountId)this.principals.set(result.id,session.accountId);
      this.send(socket, { type: "welcome", ...result });
      this.broadcast();
      return;
    }
    if (!session.id) {
      socket.close(1008, "invalidMessage");
      this.close(socket);
      return;
    }
    if (message.type === "ping") this.send(socket, { type: "pong" });
    else {
      if(message.type==='start'&&this.env.RANKINGS_DB){
        for(const connected of this.sessions.values())if(connected.id&&connected.accountId){
          const valid=await this.env.RANKINGS_DB.prepare("SELECT account_id FROM sessions WHERE token_hash=? AND account_id=? AND expires_at>?").bind(connected.sessionHash??'',connected.accountId,Math.floor(Date.now()/1000)).first();
          if(!valid)this.principals.delete(connected.id);
        }
      }
      this.room.command(session.id, message);
      if(this.rankings)await this.rankings.capture(this.room,this.principals);
      if (message.type === "leave") {
        // Send the authoritative forfeiture before closing the departing socket.
        this.send(socket, this.room.snapshot());
        socket.close(1000, "leave");
        this.close(socket);
      }
      if (!["input", "dash", "shockwave"].includes(message.type))
        this.broadcast();
    }
  }
  private close(socket: WebSocket): void {
    const session = this.sessions.get(socket);
    if (!session) return;
    this.sessions.delete(socket);
    if (session.id) this.room?.disconnect(session.id);
    try {
      socket.close();
    } catch {
      /* Already closed. */
    }
    this.broadcast();
  }
  private broadcast(): void {
    if (this.room) {
      const state = this.room.snapshot();
      for (const [socket, session] of this.sessions)
        if (session.joined) this.send(socket, state);
    }
  }
  private async validateSessions(now:number):Promise<void>{
    const authenticated=[...this.sessions].filter(([,s])=>s.accountId);
    if(!this.env.RANKINGS_DB||!authenticated.length)return;
    const hashes=authenticated.map(([,s])=>s.sessionHash??'');
    const rows=await this.env.RANKINGS_DB.prepare(`SELECT s.token_hash,s.account_id,a.display_name FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash IN (${hashes.map(()=>'?').join(',')}) AND s.expires_at>? AND a.status='active'`).bind(...hashes,Math.floor(now/1000)).all<{token_hash:string;account_id:string;display_name?:string}>();
    for(const [,session] of authenticated){const row=rows.results.find(r=>r.token_hash===session.sessionHash&&r.account_id===session.accountId);if(row?.display_name){session.accountName=row.display_name;const member=session.id?this.room?.members.get(session.id):undefined;if(member)member.state.name=row.display_name;}}
    for(const [socket,session] of authenticated)if(!rows.results.some(r=>r.token_hash===session.sessionHash&&r.account_id===session.accountId)){
      this.send(socket,{type:'error',code:'matchReset'});socket.close(1008,'session revoked');this.close(socket);
    }
  }
  private startTimer(): void {
    if (this.timer) return;
    this.previous = Date.now();
    this.timer = setInterval(() => {this.enqueue(async()=>{
      if (!this.room) return;
      const now = Date.now();
      if(this.env.RANKINGS_DB&&now-this.sessionCheckedAt>=1000){
        this.sessionCheckedAt=now;
        await this.validateSessions(now);
      }
      this.accumulator += Math.min((now - this.previous) / 1000, 0.25);
      this.previous = now;
      while (this.accumulator >= 0.05) {
        this.room.tick(0.05);
        this.accumulator -= 0.05;
      }
      if(this.rankings)await this.rankings.capture(this.room,this.principals);
      for (const [socket, session] of this.sessions)
        if (now - session.lastSeen > (session.joined ? 15000 : 5000)) {
          socket.close(1001, "timeout");
          this.close(socket);
        }
      if (
        this.room.expired ||
        (!this.sessions.size && this.room.clock > 30 && !this.room.members.size)
      ) {
        void this.expire();
        return;
      }
      if (
        this.room.phase === "playing" ||
        this.room.phase === "countdown" ||
        now - this.persistClock >= 1000
      )
        this.broadcast();
      if (now - this.persistClock >= 1000) this.persistClock = now;
    });}, 50);
  }
  async alarm(): Promise<void> {
    if(this.rankings&&!await this.rankings.deliver()){await this.ctx.storage.setAlarm(Date.now()+30000);return;}
    if (!this.room || this.room.expired) await this.expire();
    else await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_SECONDS * 1000);
  }
  private async expire(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const socket of this.sessions.keys()) {
      this.send(socket, { type: "error", code: "roomExpired" });
      socket.close(1001, "roomExpired");
    }
    this.sessions.clear();
    this.room = undefined;
    this.existed = false;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.delete('exists');
    await this.ctx.storage.delete('ranked-start');
    if(this.rankings&&!await this.rankings.deliver())await this.ctx.storage.setAlarm(Date.now()+30000);
  }
}
