# RULESHIFT Remote MCP

This repository contains a real Model Context Protocol server using the official TypeScript SDK and **stateless Streamable HTTP**, with JSON responses. The game UI does not import the MCP SDK. The existing `ruleshift` Worker keeps its URL, assets binding, WebSocket API and `GameRoom` migration.

Production endpoint: `https://ruleshift-mcp.zamusik-play.workers.dev/mcp`. Production verification confirmed Bearer authentication, MCP `initialize`, discovery of the six read-only tools, successful calls to `get_game_status`, `get_game_config`, and `get_active_matches`, and private RPC through the `ruleshift#GameInspection` Service Binding. `MCP_WRITES_ENABLED` remains `false`, so operator write tools are not advertised or callable in production.

## Architecture and existing data

```text
AI agent / MCP client
  | HTTPS /mcp + Authorization: Bearer <provisioned token>
  v
ruleshift-mcp Worker (official MCP SDK, schemas, role checks)
  |                     |
  | private RPC         +--> McpControl Durable Object
  v                          bounded monitoring list, rate limits, audit
ruleshift Worker: GameInspection named entrypoint
  |
  v
GameRoom.inspect() -> explicit redacted projection of existing Room state
```

`GameRoom` owns the authoritative in-memory `Room`, members, rule engine, cooldowns, pickups, score and match lifecycle. It persists an existence marker, not complete matches. Restarts may therefore report `reset`. The inspection path does not start a game timer, refresh room activity, send WebSocket messages or mutate gameplay.

There is no global match index, durable historical player database, aggregate lifetime server statistics or existing gameplay event log. `matchId` is a **per-room counter**, not a globally unique identifier. The local profile and achievements are browser data and are deliberately not exposed.

To avoid adding a registry heartbeat to every match, an operator explicitly registers up to **20 room codes** for observation. This is an administrative monitoring list, shared by the deployment's authorized readers. It persists in the separate MCP Durable Object. Lists and statistics always identify their scope as `monitored_rooms_only`. Room codes are invite capabilities: distribute reader credentials only to administrators allowed to inspect the monitored rooms. Registration does not establish player/host ownership. Monitoring persists until removed; reused room codes refer to the current room, not an archived match.

## Tools

| Tool                 | Permission                | Actual behavior                                                                                                                  |
| -------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `get_game_status`    | reader/operator           | Private backend binding reachability and gameplay protocol version; not a global availability guarantee.                         |
| `get_game_config`    | reader/operator           | Allowlisted constants imported from shared game modules: arena, rules, modifiers, compatible pairs, cooldowns and event timings. |
| `get_active_matches` | reader/operator           | Countdown/playing matches among monitored rooms, unavailable rooms, sampling time and monitoring revision.                       |
| `get_match_details`  | reader/operator           | Redacted authoritative state of a monitored `roomCode`; optional `expectedMatchId` rejects a different rematch.                  |
| `get_server_stats`   | reader/operator           | Current room/player counts in the monitored set; explicitly no global or lifetime totals.                                        |
| `get_recent_events`  | reader/operator           | Last 1–100 **MCP audit events**, not historical game events. Default 20.                                                         |
| `watch_room`         | operator + writes enabled | Add an existing room to monitoring. Requires `roomCode` and `expectedRevision`.                                                  |
| `unwatch_room`       | operator + writes enabled | Remove a monitored room without closing or altering it. Requires the current `expectedRevision`.                                 |

Example write arguments: `{"roomCode":"ABC234","expectedRevision":0}`. Get the revision from `get_active_matches` or `get_server_stats`. The initial revision is 0. Concurrent writes use compare-and-set; after `revision_conflict`, read the list again and obtain a new human/client decision before retrying. A repeated no-op with the current revision leaves the revision unchanged. Retrying an already committed write with an old revision may return conflict.

`update_game_config`, `enable_event`, `disable_event`, kicking players and changing match outcomes are not implemented: the current game has no safe operational API for these, and introducing one would change gameplay. Write tools manage real monitoring state rather than pretending to control unsupported game features.

## Security model

- Every MCP request except CORS preflight is authenticated. No credentials configured means HTTP 503, never anonymous access.
- Provisioned bearer tokens use 32 or more cryptographically random bytes encoded as base64url. Only SHA-256 digests, opaque actor IDs, roles and expiry times are stored in the `MCP_KEYS` Cloudflare secret. Do not reuse Cloudflare account tokens or game reconnect tokens.
- `reader` sees six tools. `operator` sees eight only when `MCP_WRITES_ENABLED` is exactly `true`. The Durable Object independently checks the write gate and role; annotations are descriptive hints, not authorization.
- A token grants access to this deployment's monitoring scope. There is no player authentication, tenant isolation or delegation. Use separate deployments if administrators must not share room visibility.
- Remote requests require HTTPS. Browser `Origin` values are rejected unless explicitly allowlisted; there is no wildcard CORS. Requests without `Origin` are supported for native/server MCP clients.
- Strict Zod schemas reject extra fields, invalid room codes and out-of-range values. POST bodies are limited to 16 KiB, including bodies without Content-Length. JSON-RPC batches are rejected.
- A shared Durable Object enforces 60 authenticated POSTs per actor per minute across isolates. At most 20 monitored rooms and four concurrent room probes per listing; individual backend probes have an eight-second timeout. Configure Cloudflare edge/WAF rate limits separately for unauthenticated traffic when needed.
- Only the named, private `GameInspection` Service Binding is available to the MCP Worker. There is no public admin HTTP route, arbitrary Durable Object ID/path, storage query, shell command, code evaluation or environment dump tool.
- Responses omit player names, player IDs, reconnect/session tokens, IP addresses, positions, credentials and raw member objects. Backend error details are replaced with bounded error codes.
- Every tool call records an attempt before execution and a sanitized outcome. Write mutation and write audit commit in the same storage transaction. Storage/audit failures fail closed. A timeout or failure after a committed write may make its response uncertain: inspect the revision/audit before retrying.
- Audit retains the latest **100 entries**, with sequence, timestamp, actor ID/role, tool and outcome. It excludes arguments, room invite codes and bearer tokens. Entries are bounded operational history, not a permanent compliance archive. Authentication failures have no authenticated actor and are not included. There is no audit deletion tool.
- Successful writes have their transactional audit entry plus the HTTP wrapper's completion entry; both are intentional, and attempts count toward retention. `get_recent_events` is itself audited.

Human confirmation belongs to the MCP client/AI agent: show the selected room and intended change, request approval when required by its policy, then call the tool with an operator token. The server does not accept `approved:true` or claim to verify a human gesture. Tool descriptions/annotations cannot replace the client's approval policy.

This version uses **pre-provisioned bearer credentials**, not an OAuth authorization server. It has no OAuth discovery, login, dynamic client registration or consent screen. Clients must support custom Authorization headers. OAuth-only remote connectors need a separately designed OAuth gateway; they cannot connect by pasting this URL alone.

## Provisioning and deployment

Nothing is deployed automatically by these instructions. Existing game deployment remains `npm run build` followed by `npx wrangler deploy` using `wrangler.jsonc`.

Before pushing, inspect the existing `ruleshift` Cloudflare Workers Builds settings. Use repository root, build command `npm run build`, and deploy command `npx wrangler deploy --config wrangler.jsonc` (the existing command without `--config` also selects the game config). Do not point the game's pipeline at `wrangler.mcp.jsonc`. This repository has no GitHub Actions workflow; Cloudflare Dashboard build triggers and commands cannot be verified from repository files. An ordinary game deploy does not automatically deploy the second config. Keep the MCP Worker disconnected from automatic Git builds for the first manual rollout.

In production, provision `MCP_KEYS` as a **runtime Cloudflare Secret on ruleshift-mcp**, not a plaintext variable, build variable, GitHub repository file or client bundle. Code receives both secrets and plain variables through `env` and cannot distinguish their origin; using the encrypted Secret type is an operator requirement. The value is the JSON keyring of hashes, not the original bearer token. No new GitHub secret or Cloudflare API token is required when using interactive `wrangler login` with the existing local Node/npm and project-installed Wrangler.

1. Run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`.
2. Check `npx wrangler deploy --dry-run` and `npm run check:mcp`. These bundle code without starting workerd or publishing.
3. Deploy the game Worker through the usual authorized workflow first. It must export the new `GameInspection` entrypoint before MCP can bind to it. No new game DO migration is needed. Like any deployment of the existing in-memory game backend, it may interrupt current matches; choose a suitable window.
4. Provision `MCP_KEYS` on the **ruleshift-mcp** Worker. Use the interactive command below so tokens/digests do not enter shell history. The secret contains a JSON array following this shape (placeholders are not valid credentials):

```json
[
  {
    "id": "qa-reader",
    "role": "reader",
    "sha256": "<64 lowercase hex characters>",
    "expiresAt": "2027-01-01T00:00:00.000Z"
  },
  {
    "id": "qa-operator",
    "role": "operator",
    "sha256": "<different 64-character digest>",
    "expiresAt": "2027-01-01T00:00:00.000Z"
  }
]
```

Generate each token with a trusted secret manager or Node's `crypto.randomBytes(32).toString('base64url')`; calculate its digest using `crypto.createHash('sha256').update(token).digest('hex')`. Keep the original token only in the client/secret manager. IDs and digests must be unique. Rotate/revoke by replacing the secret array; expired entries cannot authenticate. Never commit a filled secret file. No production credentials are generated by this implementation.

```sh
npx wrangler secret put MCP_KEYS --config wrangler.mcp.jsonc
npx wrangler deploy --config wrangler.mcp.jsonc
```

For the first rollout, `secret put` may ask to create the missing `ruleshift-mcp` Worker: verify the account/name before accepting, then perform the explicit MCP deploy above. Secret updates are publishing operations, not local preparation. Alternatively, deploy the MCP Worker first with no keys (MCP requests fail closed with 503), then add `MCP_KEYS` through that Worker's Settings > Variables and Secrets using type **Secret**, and apply the change. Never add this key to the game Worker. Do not manually create a second Durable Object namespace: the MCP config and migration create its binding.

5. The separate Worker config creates a new SQLite-backed `McpControl` Durable Object with its own `v1` migration. Its `GAME` Service Binding targets service `ruleshift`, entrypoint `GameInspection`, in the same account. If using environment-specific Worker names, update this binding to that exact backend.
6. Writes are disabled in the checked-in config. To enable them deliberately, set `MCP_WRITES_ENABLED` to the string `"true"` in the MCP Worker configuration and redeploy that Worker. All credentials still have independent roles. Keep this value consistent with the config used by later CI deployments.
7. Browser-based MCP clients additionally need their exact origin in `MCP_ALLOWED_ORIGINS`, a JSON array string. Native SDK clients need no Origin allowlist entry.

Production endpoint:

`https://ruleshift-mcp.zamusik-play.workers.dev/mcp`

The game remains at `https://ruleshift.zamusik-play.workers.dev`. The game and MCP Workers are deployed separately; the existing game pipeline uses `wrangler.jsonc` and does not publish `wrangler.mcp.jsonc`.

## Client connection and agent examples

Transport: **Streamable HTTP**. URL: the MCP endpoint above. Header: `Authorization: Bearer <client token>`. Do not put the token in the URL. Discovery uses `initialize` then `tools/list`; calling uses `tools/call`. The SDK handles protocol negotiation and `notifications/initialized`. JSON replies and no session IDs are intentional. GET/SSE subscriptions and DELETE/session termination are not implemented (405); stateless operation does not require them.

The repository includes a read-only official SDK example:

```sh
node scripts/mcp-client.mjs
```

Set `RULESHIFT_MCP_URL` and `RULESHIFT_MCP_TOKEN` in that process's environment using your secret manager. The script connects, discovers tools, reads status/config/active monitored matches and closes the client. It performs no writes and does not print credentials. It is usable as a post-deployment smoke test.

Useful agent workflows:

- Reader: “Check whether the backend binding responds, list monitored active matches, then summarize their authoritative rules and player counts.”
- Reader: “Inspect room ABC234, match 2. If that room has moved to a different match, report the mismatch instead of describing stale state.”
- Operator, after client-side approval: “Read the monitoring revision, watch room ABC234, then confirm the updated list and audit entry.”
- Operator, after client-side approval: “Stop observing ABC234 without altering or closing its game.”

## Tests and manual QA

Verification on 2026-09-27: **49/49 tests passed** (38 existing and 11 new); client, game Worker and MCP Worker TypeScript checks passed; the Vite production build passed. Both game and MCP Wrangler dry-runs passed. The existing Phaser bundle-size warning remains. A subsequent production smoke-test confirmed the deployed endpoint, Bearer authentication, MCP initialization/discovery, three read-only tool calls, Durable Object access, and the private game Service Binding. The production credential and `MCP_KEYS` value are not stored in this repository.

Files added: `mcp/auth.ts`, `mcp/contracts.ts`, `mcp/control.ts`, `mcp/index.ts`, `mcp/server.ts`, `worker/observability.ts`, `wrangler.mcp.jsonc`, `tsconfig.mcp.json`, `tests/mcp.test.mjs`, `scripts/mcp-client.mjs`, and this document. Files updated: `worker/index.ts` (private read adapter), `tests/worker.test.mjs` (binding isolation), `package.json` / `package-lock.json` (SDK, Zod and checks), and `README.md` (integration overview). No `src/` gameplay, client or localization file was changed for MCP.

Automated tests use the **real official MCP server, transport and client SDK** with in-process HTTP Request/Response handling. Only Cloudflare RPC/storage are represented by deterministic adapters. Tests cover negotiation, discovery, all eight tools, role separation, write disablement, strict validation, malformed requests, size/origin/version checks, expiry, redaction, backend errors, bounded shared limits, concurrent revision conflicts and atomic storage/audit failure. Existing gameplay tests remain part of `npm test`.

Automated tests alone do not certify Cloudflare persistence or all external MCP clients. The completed production smoke-test covers TLS, authentication, initialize, discovery, selected read calls, the control Durable Object, and Service Binding RPC. Write tools, audit persistence across restarts, browser-origin CORS, throttling under load, and OAuth-only clients remain outside that smoke-test. The known Windows `workerd.exe EPERM` restriction is not worked around; starting the local runtime is optional when that restriction is resolved. `npm run dev:mcp` is for an environment where workerd works and the game service binding has been configured locally; do not use remote development as an implicit deployment.

After authorized production deployment, verify:

1. Normal Solo and RU/EN still work; two real devices can create/join, play, reach Results and rematch.
2. The game has no public inspection/admin route; the MCP Worker can reach `GameInspection` through its Service Binding.
3. Missing/invalid/expired tokens return 401; missing secrets return 503. A reader discovers six tools and cannot force a write call.
4. Explicitly enabled operator credentials discover eight tools. Watch a known QA room, read the same match in MCP and the game, unwatch it, and inspect audit outcomes.
5. Different language clients see the same authoritative state. MCP returns localization keys, not player locale-dependent game state.
6. A stale revision conflicts, restarting/resetting a room reports unavailable, and Durable Object monitoring/audit survive an MCP Worker restart.
7. Check actual external-client header support, Origin policy, 429 behavior and error redaction. Verify that old or revoked credentials stop working.

References: [official MCP SDK server documentation](https://ts.sdk.modelcontextprotocol.io/server), [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [Cloudflare private Service Binding RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/).
