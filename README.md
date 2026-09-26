# RULESHIFT

**Rules change. Survive.** A dark neon survival arcade built with TypeScript and Phaser 3. Read the warning, adapt to the next rule, and stay alive. Play Solo or challenge friends in a private Last Alive room.

## Live Demo

[Play RULESHIFT](https://ruleshift.zamusik-play.workers.dev)

This is the existing production URL. The v1.0 changes in this working tree have **not been deployed**. Online functionality described below belongs to this version, not necessarily to the currently published demo.

## Features

- Ten rules with preparation windows, visible hazards, recovery phases, and no immediate repeats.
- Compatible Chaos pairs after 60 seconds; increasing difficulty at 30 and 60 seconds.
- Three HP, one-second damage immunity, survival scoring, and a capped ×5 rule streak bonus.
- Local name, eight preset colors, statistics, eight achievements, and legacy best-score migration.
- English and Russian, including rules, errors, lobby, results, and achievements.
- Keyboard and analog touch controls with a dead zone and reliable pointer cancellation.
- Private 2–8 player Last Alive rooms implemented using Cloudflare Durable Objects and WebSockets.
- Procedural visuals and synthesized sound effects: no downloaded art, fonts, or audio assets.

## Solo Mode

The original arena, movement feel, health model, and five rules are retained. Rules now have a renderer-independent simulation shared with Online.

| Rule            | What to do                                                                 |
| --------------- | -------------------------------------------------------------------------- |
| Keep Moving     | Do not stand still for 1.2 seconds. Pushing against a wall does not count. |
| Danger Zones    | Leave the marked circles before the 1.5-second warning ends.               |
| Center Now      | Reach the center circle within 4 seconds, reducing to 3.5 on Hard.         |
| Dodge           | Avoid projectiles aimed at a player's position when they spawn.            |
| Don't Move      | Prepare for 1.8 seconds, freeze for 2 seconds, then wait for release.      |
| Laser Sweep     | Avoid a descending beam; use the gaps at its ends.                         |
| Shrinking Arena | Stay inside the gradually contracting safe border.                         |
| Hunter          | Keep away from a slower pursuer after its warning.                         |
| Meteor Shower   | Leave targeted circles before impact, 1.25 seconds after marking.          |
| Symbol Match    | Reach the requested I / II / III zone. Symbols supplement color.           |

Each cycle has a 1.5-second announcement, 4–6 active seconds, and a 2.5-second recovery. Hazards are cleared between rules. Chaos uses an explicit allowlist: Keep Moving + Meteor Shower, Keep Moving + Hunter, or Dodge + Shrinking Arena.

Score increases by 10 per second. A clean rule awards `100 × min(streak, 5)` per rule in the round. Violations reset the streak, including violations during damage immunity. The game pauses on focus loss in Solo; resume explicitly or end the run from the pause screen.

## Online Multiplayer

Create a room, share its six-character code, and ask friends to join. Names do not have to be unique: the server issues independent player IDs and reconnect tokens. Duplicate preferred colors are reassigned only inside that room.

The host starts when 2–8 connected players are ready. A three-second countdown leads into Last Alive. All players share the same rules and hazards. Eliminated players become spectators and cannot submit effective movement input. The final survivor wins; simultaneous elimination is a draw. The host can return everyone to the same lobby for a rematch. Readiness resets between matches.

The server owns movement, HP, collision checks, elimination, rule selection, timing, hazards, match state, and winner selection. Clients send normalized input at 20 Hz; snapshots are broadcast at 20 Hz while playing. Player rendering interpolates toward authoritative positions. There is no client authority over score or health and no rollback/prediction engine.

Disconnected players stop receiving input immediately and remain vulnerable. An in-memory reconnect token allows the same tab to reconnect within eight seconds. After grace expires, a disconnected participant forfeits; lobby host ownership transfers. Refreshing the page loses the token. Online matches do not pause when a tab is hidden or a device rotates. Idle rooms expire after 15 minutes; matches are capped at ten minutes and end in a draw if multiple survivors remain.

**Verification status:** room simulation, protocol validation, and Worker handlers have automated coverage. Actual workerd-based WebSocket integration could not be executed on the development machine because Windows denied `workerd.exe` execution. Run the integration smoke test and two-device checklist before treating Online as production-verified.

## Mobile Support

The canvas keeps the original 1160 × 720 logical resolution and aspect ratio. Layout uses dynamic viewport units and safe-area insets. Coarse-pointer touch devices show an orientation overlay in portrait. Desktop windows do not show that overlay.

The touch joystick supports 360-degree analog movement, a 16% dead zone, pointer capture, and reset on pointer up, cancel, lost capture, blur, visibility change, or resize. Gameplay suppresses accidental scroll and selection inside the game surface; menus and profile panels remain scrollable. Primary controls have at least 44-pixel touch targets.

Desktop browser layouts were inspected at 844 × 390 and 1024 × 768. These are viewport checks, **not** physical Android/iPhone/iPad certification. See [manual QA](docs/QA.md) for the remaining device tests.

## AI Agent / MCP Integration

RULESHIFT includes a separate **Remote MCP Server** using the official Model Context Protocol SDK and stateless Streamable HTTP. It inspects the live game's redacted authoritative state through a private Cloudflare Service Binding. It does not change Solo, gameplay rules, the public game URL or the multiplayer WebSocket protocol.

```text
AI agent / MCP client --HTTPS + bearer token--> ruleshift-mcp Worker
                                                |             |
                                   private Service Binding    McpControl DO
                                                |             monitoring + audit
                              ruleshift / GameInspection --> GameRoom
```

Read tools: `get_game_status`, `get_active_matches`, `get_match_details`, `get_game_config`, `get_server_stats`, `get_recent_events`. Lists/statistics cover only explicitly monitored rooms; recent events are the bounded MCP audit, not invented gameplay history. The existing backend has no global match registry or lifetime metrics.

Write tools: `watch_room` and `unwatch_room`, protected by operator credentials, a disabled-by-default write flag, strict validation, revision checks and atomic audit logging. They manage monitoring without modifying a match. Human confirmation is a responsibility of the MCP client/agent before calling a write tool.

Deploy the game backend update first, then deploy `wrangler.mcp.jsonc` separately after provisioning its `MCP_KEYS` secret. Planned endpoint: `https://ruleshift-mcp.zamusik-play.workers.dev/mcp` (not published by this implementation). Connect using Streamable HTTP with a provisioned bearer Authorization header. OAuth-only clients are not supported by this initial authentication model.

See [MCP architecture, security, client examples and deployment instructions](docs/MCP.md). A read-only SDK example is available at `scripts/mcp-client.mjs`; set `RULESHIFT_MCP_URL` and `RULESHIFT_MCP_TOKEN` through your local secret manager before running it. `npm test` includes protocol tests with the real SDK; `npm run check:mcp` performs an unpublished Cloudflare bundling dry run.

## Localization

Typed English and Russian dictionaries live in `src/locales/`. The first launch uses Russian for a Russian browser locale and English otherwise. A manual selection is stored separately and takes precedence on future visits. Menu language changes apply immediately. System Arial/sans-serif fonts support Latin and Cyrillic.

## Controls

| Action              | Control                             |
| ------------------- | ----------------------------------- |
| Move                | WASD, arrow keys, or touch joystick |
| Stop on touch       | Release the joystick                |
| Pause / resume Solo | Escape or the pause button          |
| End Solo            | Pause → End Run                     |
| Leave Online        | The × button or Leave Room          |
| Language / sound    | Menu or Profile settings            |

Sound is synthesized with Web Audio and starts only after user interaction. Muting is saved locally. Audio failure does not prevent play.

## Architecture

```text
src/
  scenes/ArenaScene.ts     Existing Solo orchestration, menu transitions, effects
  arena.ts                Shared procedural arena rendering
  player.ts               Solo player using shared movement and input
  playerView.ts           Shared procedural player appearance
  input.ts                Keyboard + pointer joystick -> normalized input
  rules.ts                Solo adapter around the shared rule engine
  ruleView.ts             Rendering authoritative hazard snapshots
  shared/
    movement.ts           Platform-independent movement and damage
    ruleEngine.ts         Ten rules, transitions, hazards, compatibility
    room.ts               Last Alive room and match state machine
    protocol.ts           Network types and strict client message validation
    identity.ts           Display name, palette and room-code validation
    scoring.ts            Rule bonuses and streaks
  online/client.ts        Room UI, WebSocket lifecycle, snapshots, interpolation
  locales/                Typed EN/RU text dictionaries
  profile.ts              Versioned persistence, migration, statistics, achievements
  ui.ts / hud.ts          DOM screens and responsive HUD
  audio.ts / device.ts    Synthesized cues and orientation handling
worker/index.ts           HTTP routing + one GameRoom Durable Object per room
tests/                    Rules, profile, input, protocol, room and Worker tests
```

Solo runs entirely in the browser. Online adds only the Cloudflare room server. Shared simulation has no Phaser or DOM dependency. Room orchestration is separate from the renderer so future modes can reuse movement, hazards, identity, and transport.

Persistent local data uses `ruleshift.profile.v1` and `ruleshift.language`. The old `ruleshift.best` value is migrated. Local data is convenience data, never a source of competitive server authority. No accounts, database-backed profiles, chat, analytics, or frontend secrets are required.

## Tech Stack

- TypeScript
- Phaser 3
- Vite
- Cloudflare Workers
- SQLite-backed Durable Object namespace (ephemeral game state is held in memory)
- WebSockets
- Wrangler
- Browser Web Audio / Pointer Events / localStorage
- Node.js test runner

## Local Development

Use a recent Node.js LTS release; **Node 22.12+** is recommended (development checks used Node 24). Install dependencies:

```sh
npm ci
```

Solo and frontend development:

```sh
npm run dev
```

Open the Vite address, normally `http://127.0.0.1:5173`.

Full local Cloudflare application:

```sh
npm run build
npm run dev:online
```

Open `http://127.0.0.1:8787` in two browser windows/profiles. Wrangler uses local Durable Objects; it does not deploy this application. The command serves the built `dist/`, so rebuild after frontend edits. For frontend HMR, keep Wrangler running and use `npm run dev` in another terminal; Vite proxies `/api` and WebSockets to port 8787.

For a physical device on your trusted LAN, explicitly run `npx wrangler dev --ip 0.0.0.0 --port 8787` and open the computer's LAN address on the same Wi-Fi network. This exposes the local development server to that LAN. Prefer an HTTPS deployment you control for final Safari/device testing. Do not use Wrangler's remote development mode as a substitute for local tests.

Checks:

```sh
npm test
npm run typecheck
npm run build
npx wrangler deploy --dry-run
```

With the local Wrangler server running:

```sh
npm run test:online
```

The integration script permits localhost only and checks actual HTTP/WebSocket create/join, colors, readiness, server movement, reconnect, winner by forfeit, and rematch. It is separate from unit tests. Worker-handler unit tests use simulated socket/runtime objects and are not a substitute for this test.

If Windows reports `spawn EPERM` or denies `workerd.exe`, local Cloudflare runtime verification is blocked by the machine environment. Do not disable security controls or deploy to work around it; ask the machine administrator to resolve the runtime restriction, then repeat the local checks. Vite Solo, TypeScript, unit tests, and Wrangler's bundling dry run can still be checked independently.

## Production Build

```sh
npm run build
```

This type-checks both client and Worker code and builds the frontend into `dist/`. Wrangler bundles `worker/index.ts` separately. `npm run preview` previews static assets only; it does not start the room server. Phaser's bundle-size warning is informational; the build succeeds.

## Cloudflare Deployment

Only deploy after reviewing the changes and completing Online/device QA.

1. Use the existing Cloudflare account that owns `ruleshift.zamusik-play.workers.dev`. Run `npx wrangler login`, then `npx wrangler whoami` to verify the account.
2. Keep `name: "ruleshift"` in `wrangler.jsonc`; this updates the existing Worker. If your login can access multiple accounts, select the correct account when Wrangler asks or configure its account ID explicitly. No account ID is guessed in this repository.
3. Inspect the config: `main` points to `worker/index.ts`; `ASSETS` serves `./dist`; only `/api/*` uses Worker-first routing; `ROOMS` binds to exported class `GameRoom`.
4. Keep migration `v1` with `new_sqlite_classes: ["GameRoom"]`. On the first actual deployment, Wrangler creates the namespace and binding. No separate Dashboard-created Durable Object binding is needed. Do not remove or rename an applied migration; future class/storage changes need a new migration tag.
5. Confirm the account permits Durable Objects and has suitable limits. This implementation uses regular WebSockets and a running room timer, not hibernation; connected room duration can incur usage charges. Review Cloudflare's applicable limits before public release.
6. Run `npm ci`, `npm test`, `npm run build`, and `npx wrangler deploy --dry-run`.
7. When you decide to publish, run **`npx wrangler deploy`** yourself. This publishes the Worker and assets together. No deployment has been executed as part of this change.
8. Open the existing Live Demo and verify Solo, two-browser Online, reconnect, and a phone/desktop match. For an existing custom domain, retain its current route; none is guessed or added here.

If Cloudflare Workers Builds is connected to GitHub, use `npm run build` as the build command and `npx wrangler deploy` as the deploy command, with the repository root as the project directory.

## Known Limitations

- Native Cloudflare runtime execution was blocked on the development Windows machine; Online needs the real local integration and multi-browser QA before release.
- Physical Android, iPhone, Android tablet, and iPad behavior remains to be verified. Viewport resizing alone cannot validate touch, Safari audio, safe areas, or suspension.
- Rooms are ephemeral. A Durable Object restart or deployment ends in-memory matches. The UI asks players to create a new room; active matches are not restored from storage.
- Reconnection is best-effort for the same tab within eight seconds. Mobile sleep, page refresh, or longer interruptions forfeit the session. Disconnected players remain vulnerable.
- Only Last Alive is implemented. No matchmaking, accounts, persistent cloud profiles, chat, or global leaderboard.
- Input interpolation favors simplicity over high-latency responsiveness. No lag compensation or client prediction.
- Creation throttling is per Worker isolate, not a global anti-abuse service. WebSocket payload/type/value validation and per-connection rate limits are enforced; production-scale abuse protection may require Cloudflare edge rules.
- Local stats are not tamper-proof and may be lost if storage is cleared/blocked. Names are validated, not moderated.
- Difficulty and the new hazard/Chaos combinations need extended human balance playtests.

## Roadmap

- Complete the device matrix, real workerd smoke test, and multi-client soak tests.
- Tune warning visibility, mobile readability, latency, and late-game difficulty from playtests.
- Consider durable room recovery and hibernating idle lobbies after measuring room usage.
- Evaluate Hot Potato, Infected, King of the Hill, and Color Rush only after Last Alive is stable.

See [QA checklist and verification record](docs/QA.md) for release checks and the distinction between completed and pending verification.
