# RULESHIFT — фактический отчёт о проекте

> Источники: текущие исходники, конфигурации, README, `docs/QA.md`, тесты и git history. Этот отчёт не утверждает то, чего нельзя подтвердить этими источниками. Состояние: 2026-10-04.

## 1. Краткое описание

**Очень просто.** RULESHIFT — браузерная игра на реакцию. На экране появляются меняющиеся правила: например, двигаться, не двигаться, уйти из опасной зоны или уклониться. Игрок читает предупреждение и выживает как можно дольше. Можно играть одному или создать закрытую комнату и играть с друзьями: остаётся последний выживший.

**Для собеседования.** Это TypeScript/Phaser 3 survival arcade с одиночным режимом и приватным multiplayer Last Alive. Один и тот же доменный код правил, движения, коллизий и состояния комнаты используется в Solo и в авторитетной серверной симуляции Cloudflare Durable Objects. Клиенты WebSocket отправляют ввод, а сервер вычисляет состояние и рассылает snapshots. Отдельный Cloudflare Worker реализует защищённый Remote MCP для наблюдения за ограниченным набором комнат.

**Пользовательский путь.** Открывает сайт → выбирает язык/звук/локальное имя и цвет → запускает Solo либо создаёт/вводит код комнаты → читает предупреждения и управляет персонажем клавиатурой или touch-джойстиком → получает результат → в Online может сыграть rematch или выйти.

Польза — короткая браузерная игра без установки, пригодная для демонстрации игрового UI, multiplayer state synchronization и Cloudflare Workers. Целевая аудитория не описана в коде; разумно говорить только о людях, которым нравятся короткие arcade/survival игры и приватные матчи с друзьями.

## 2. Реальные функции

| Функция | Продуктовый смысл и работа | Участвующие части |
|---|---|---|
| Solo survival | Игрок переживает последовательность правил и набирает очки. Есть 10 правил, предупреждение, активная фаза и восстановление. | Phaser scene, `src/rules.ts`, shared rule engine |
| Правила и опасности | Keep Moving, Danger Zones, Center Now, Dodge, Don't Move, Lasers, Shrinking Arena, Hunter, Meteors, Symbol Match; есть совместимые Chaos-пары, модификаторы и поздние события. | `src/shared/ruleEngine.ts`, `variants.ts`, `ruleView.ts` |
| Очки/достижения | Выживание, серия чистых правил до ×5, локальные статистики и 8 achievements. | `scoring.ts`, `profile.ts`, browser storage |
| Online Last Alive | Хост создаёт код, 2–8 игроков входят, все готовы, хост запускает матч; победитель — последний живой. | Vite client, WebSocket, Worker, `GameRoom` DO |
| Авторитетный сервер | Клиент посылает нормализованный input, сервер владеет HP, движением, коллизиями, правилами, результатом и snapshots. | `online/client.ts`, `worker/index.ts`, `shared/room.ts` |
| Reconnect/rematch | Тот же tab может вернуться с reconnect token в пределах 8 секунд; хост может вернуть комнату в lobby для новой игры. | protocol/room/client |
| Mobile controls | Аналоговый joystick с dead zone, pointer capture и обработкой cancel/blur; размеры Small/Medium/Large. | `input.ts`, `controlSettings.ts`, CSS |
| RU/EN и accessibility basics | Русский/английский словари, сохранение выбора, touch targets, portrait overlay на touch-устройствах. | `src/locales`, `device.ts`, UI/CSS |
| Remote MCP monitoring | Отдельный Worker читает обезличенное состояние явно наблюдаемых комнат через private Service Binding. | `mcp/`, `worker/observability.ts`, Cloudflare DO |

## 3. Tech stack

| Категория | Технология | Для чего и где |
|---|---|---|
| Языки | TypeScript, JavaScript, HTML, CSS, JSON/JSONC | TypeScript — игра, Workers и MCP; JS — Node tests/client script; HTML/CSS — оболочка и интерфейс; JSONC — Wrangler config. Python, Java, SQL отсутствуют. |
| Frontend | Phaser 3 | Canvas-сцена, отрисовка и игровой цикл Solo: `src/scenes/ArenaScene.ts`. |
| Frontend | Vite | Локальная разработка и production build в `dist`: `vite.config.ts`, npm scripts. |
| Frontend | Web Audio API | Синтез простых звуков после user interaction: `src/audio.ts`; внешних audio assets нет. |
| Backend | Cloudflare Workers | HTTP routes игры и отдельный MCP endpoint. Это не Node/Express/FastAPI server. |
| Real-time | WebSocket | Двусторонний Online transport: клиент `online/client.ts`, Worker/DO `worker/index.ts`. |
| State/storage | Cloudflare Durable Objects | `GameRoom` хранит активную комнату в памяти; `McpControl` хранит monitoring, rate state и audit. Это не PostgreSQL/Redis/SQLite application database. |
| Deployment | Wrangler | Bundling/deploy Cloudflare Workers и static assets. |
| MCP | `@modelcontextprotocol/sdk` | Реальный stateless Streamable HTTP server/client, tools и protocol negotiation. |
| Validation | Zod | Строгие схемы MCP arguments и keyring: `mcp/contracts.ts`, `mcp/auth.ts`. |
| Testing | Node built-in test runner | `node --test tests/*.test.mjs`; unit/integration-style tests без Jest/Vitest/Playwright. |
| Tooling | TypeScript compiler | Три проверки: client, game Worker, MCP Worker. |

Нет React, Next.js, Docker, SQL database, ORM, REST framework, Python backend, ML/CV, embeddings, RAG или vector DB.

## 4. Архитектура

```text
Solo player ──> Vite/Phaser client ──> local shared game logic

Online player ─> browser WebSocket ─> ruleshift Worker (/api/rooms)
                                      └> GameRoom Durable Object
                                          authoritative Room simulation

MCP client ───> ruleshift-mcp Worker (/mcp, Bearer token)
                   ├> McpControl Durable Object (monitoring/rate/audit)
                   └> private Service Binding RPC
                       └> ruleshift#GameInspection ─> GameRoom.inspect()
```

`src/shared/` — бизнес-правила, независимые от Phaser и Cloudflare: `room.ts` — state machine Online, `ruleEngine.ts` — правила/опасности, `movement.ts` — движение/dash/damage, `protocol.ts` — сетевые сообщения. Solo связывает их с Phaser. Online client визуализирует snapshots и интерполирует игроков; он не доверяет себе в вопросах здоровья или результата.

Постоянная игровая БД отсутствует. `GameRoom` сохраняет лишь marker существования; полный матч и игроки живут в памяти, поэтому restart/deploy может дать `matchReset`. Браузерный `localStorage` хранит профиль, язык, звук и настройки управления локально. `McpControl` использует SQLite-backed Durable Object storage, но это служебное состояние MCP, не профиль игроков.

Публичный API — game Worker `/api/*`; private API — `GameInspection` entrypoint доступен только через same-account Service Binding. Authentication есть у MCP; у игровой комнаты нет account login: identity — имя, цвет, server-generated ID и reconnect token.

AI/CV logic в игре отсутствует. MCP — интерфейс для внешнего AI-compatible client, но проект не вызывает LLM и не содержит model inference.

## 5. Data flow: основные сценарии

### Solo
1. Пользователь запускает Solo в UI.
2. `ArenaScene` создаёт игрока и `Rules` adapter.
3. Keyboard/touch превращается в нормализованный вектор `input`.
4. Shared movement/rule engine обновляет позицию, HP, hazards и score в browser.
5. Phaser рисует состояние; профиль сохраняется локально после результата. Сети и серверной БД нет.

### Создание и подключение Online-комнаты
1. Хост отправляет `POST /api/rooms`.
2. Worker rate-limits создание по `CF-Connecting-IP`, создаёт шестизначный код и вызывает DO `/initialize`.
3. `GameRoom` создаёт `Room`, ставит alarm и возвращает `{code}`.
4. Игрок открывает `GET /api/rooms/:code` с WebSocket upgrade, затем отправляет `hello` с protocol/name/color и возможно reconnect token.
5. Сервер выдаёт `welcome` с player id/token, принимает `ready/start/input/dash/shockwave`, валидирует и broadcast-ит `state`.

### Матч и rematch
1. 2–8 подключённых игроков готовы; хост шлёт `start`.
2. `Room` идёт через 3-second countdown и затем тикает на сервере каждые 50 ms.
3. Сервер шлёт snapshots примерно 20 Hz; client интерполирует rendering.
4. При одном survivor или simultaneous elimination сервер формирует results/draw.
5. Хостский rematch возвращает всех в lobby и сбрасывает readiness, abilities, pickups, scores и placements; это покрыто тестом на три цикла.

### MCP read
1. MCP client посылает HTTPS `POST /mcp` с `Authorization: Bearer`.
2. `mcp/auth.ts` SHA-256-хеширует токен и сверяет его с hash-only entries Cloudflare Secret `MCP_KEYS`.
3. `mcp/index.ts` проверяет origin/content type/body size/rate limit через `McpControl`.
4. SDK обрабатывает `initialize`, `tools/list` или `tools/call`.
5. Tool читает `GAME` Service Binding или monitoring/audit DO; клиент получает красную проекцию без IDs, имён и reconnect tokens.

## 6. Database / data model

Реляционной application database, таблиц, foreign keys, SQL migrations и ORM нет. Поэтому нельзя говорить о PostgreSQL/SQLite модели пользователей или incidents.

Реальные модели:

- `Room` (`src/shared/room.ts`): code, phase, members map, rule state, pickups, winner, timer. Members включают server-side state; они не persisted as user accounts.
- Durable Object `GameRoom`: runtime owner одной комнаты; в storage помещается marker `exists` и alarm, не match snapshot.
- Durable Object `McpControl`: один именованный instance хранит `revision`, до 20 room codes, до 100 audit events и per-actor minute buckets.
- Browser local profile: имя, preferred color, best score, achievements, selected locale/audio/control settings. Это device-local и может быть очищено пользователем.

## 7. API

| Группа | Method/path | Кто вызывает | Назначение |
|---|---|---|---|
| Game | `POST /api/rooms` | browser | Создать комнату, вернуть code; origin check и limit 12 creations/minute per isolate/IP map. |
| Game | `GET /api/rooms/:code` + WebSocket Upgrade | browser | Подключиться к комнате и получать snapshots. Non-upgrade GET возвращает краткий room status. |
| Game protocol | WebSocket `hello`, `ready`, `start`, `input`, `dash`, `shockwave`, `leave`, `ping` | участник комнаты | Ввод и действия; payload строго валидируется. |
| MCP | `POST /mcp` | authenticated MCP client | Streamable HTTP JSON-RPC: initialize, tools/list, tools/call. |
| MCP private | `GAME.getStatus/getConfig/inspect` | только `ruleshift-mcp` binding | RPC entrypoint, не публичный URL. |

Нет endpoints auth/users/biometrics/incidents/admin. Проверки прямо подтверждают, что `/api/admin` и room inspection HTTP route возвращают 404.

## 8. Auth и security

**Реализовано.** MCP требует Bearer token, хранит только SHA-256 digest в Cloudflare Secret, проверяет expiry/уникальность identity/hash; `reader` видит 6 tools. `operator` может увидеть 8 только при exact `MCP_WRITES_ENABLED=true`; production flag подтверждён как `false`. Есть HTTPS-only remote MCP, allowlist Origin, 16 KiB body cap, JSON-RPC batch rejection, 60 authenticated POST/minute per actor, max 20 monitored rooms, backend timeout 8s и bounded audit. Monitoring writes имеют expected revision and atomic audit. Responses redacted.

Игра проверяет origin для `/api`, room codes, protocol payloads и WebSocket message rate (70/s per session). Client не является авторитетом для HP/score. Reconnect token передаётся только владельцу после `welcome`; snapshots не должны его содержать.

**Ограничения.** Нет user accounts, passwords, JWT, cookies, CSRF, RBAC для game players, OAuth, tenant isolation, global rate limiter или permanent compliance audit. `createRates` — Map конкретного Worker isolate, не распределённая защита. Room codes — invite capabilities. Local profile не tamper-proof. "Production-grade" или "сертифицированная безопасность" говорить нельзя.

## 9. AI / agent / MCP

В продукте нет AI feature, LLM, RAG, embeddings, vector search или autonomous agent. AI coding agents могли участвовать в разработке, но это не пользовательская AI-функция.

Есть production Remote MCP endpoint `https://ruleshift-mcp.zamusik-play.workers.dev/mcp`. Read-only discoverable tools: `get_game_status`, `get_game_config`, `get_active_matches`, `get_match_details`, `get_server_stats`, `get_recent_events`. Они видят только monitored rooms; global match registry и historical stats отсутствуют. Code содержит потенциальные monitoring writes `watch_room/unwatch_room`, но при production flag false они не advertised/callable. Human approval относится к policy внешнего MCP client; сервер не эмулирует подтверждение.

## 10. Роль человека и AI-агента

Git author у всех видимых commits — `Zamirzhan Janbakiyev`; сам по себе Git author не доказывает, кто печатал строки кода. История текущей работы подтверждает человеческую роль product owner/reviewer: постановка требований, запрет лишних функций/deploy, выбор Cloudflare pipeline, ручная production проверка и решение о commit/push. Production smoke-test был подтверждён человеком.

Честная формулировка: «Я вёл проект как владелец требований: описывал поведение, принимал архитектурные и продуктовые решения, проверял результаты и production smoke-test. Для реализации и анализа использовал AI coding agent; код, тесты и документация создавались/изменялись агентом под мои задачи, затем я проверял и принимал изменения». Нельзя утверждать «я лично вручную написал весь код», если это не так.

## 11. Типичный workflow с AI

Подтверждённый workflow: идея/спецификация → агент анализирует существующий код → изменение маленькими слоями → automated tests/typecheck/build/dry-run → ручная проверка человеком → bug report с фактическим симптомом → минимальная коррекция → повторная regression → человек разрешает commit/push/deploy.

Реальные примеры из history: v1.0 добавил Online, локализацию и QA; следующий commit добавил dash, power-ups, directional laser, modifiers, rematch/mobile improvements и tests; затем отдельная MCP интеграция; production MCP ответил 503 из-за invalid secret format, после чего агент добавил безопасную диагностику, а человек исправил secret и подтвердил production smoke-test.

## 12. Сложные кейсы, которые реально покрыты

Важно: tests и commits подтверждают, что код учитывает эти случаи; git history не всегда доказывает, что каждый был найден как отдельный user bug.

1. **Rematch state leakage.** Проверен сброс abilities/pickups/scores/placements в трёх rematch cycles (`dynamics.test.mjs`). Это защищает от переноса старого матча.
2. **Direction-dependent lasers.** Для TOP/BOTTOM/LEFT/RIGHT проверяются warning edge, movement и collision; double laser получает новый warning/second direction.
3. **Touch joystick stuck input.** Input reset проверяется на pointer up/cancel/lost capture/blur/visibility/resize; это предотвращает "залипшее" движение.
4. **Client authority spoofing.** Invalid/stale Online input, HP spoof, dash in lobby/cooldown и message abuse отклоняются сервером; test проверяет, что state не меняется.
5. **Reconnect/disconnect lifecycle.** Grace period 8 seconds, vulnerable disconnected player и host transfer — отдельные room tests.
6. **MCP private data leakage.** Inspection projection явно не сериализует member/name/id/token/raw snapshot; tests ищут секретные test strings в ответах.
7. **MCP write race.** `expectedRevision` compare-and-set допускает один из двух конкурентных watch calls, второй конфликтует; audit/storage bounded.
8. **MCP keyring misconfiguration.** После production 503 добавлены distinction `auth_secret_missing`/`auth_secret_invalid` и redacted client diagnostics; production затем успешно прошёл smoke-test.
9. **No public admin surface.** Tests подтверждают 404 для `/api/admin` и inspection HTTP route, при работающем private Service Binding.

## 13. Performance

Реальные параметры: Online simulation tick — 50 ms (20 Hz); клиент отправляет normalized input 20 Hz; snapshots broadcast примерно 20 Hz. Game room limits accumulated delta to 0.25s. MCP probes ограничены четырьмя параллельными calls и 8 seconds timeout; list — максимум 20 rooms.

Vite build выдаёт warning: JavaScript bundle около 1.27 MB, gzip около 356 KB (предыдущая подтверждённая проверка). Нет benchmark, latency telemetry, load test, profiling или доказательства масштабирования, поэтому нельзя заявлять measured performance/SLA.

## 14. Testing

Подтверждённый набор — **49 Node tests**. Он покрывает shared rules, scoring, local profile, movement, room protocol/state machine, Online client state, Worker route/abuse cases, MCP protocol/auth/redaction/race limits. Есть manual QA checklist и visual HTML/JS utilities. Production MCP smoke-test подтвердил endpoint, initialize, discovery и три read calls.

Не подтверждены полноценный workerd local WebSocket runtime на Windows (`workerd.exe EPERM`), physical Android/iPhone/iPad matrix, browser E2E framework, multi-client soak/load test, MCP write production flow и persistence across restart. `npm test`, `npm run typecheck`, `npm run build`, `npm run check:mcp` — базовые проверки перед изменениями.

## 15. Запуск и deployment

Локально: `npm run dev` (Vite), `npm run dev:online` (game Worker, если runtime доступен), `npm run dev:mcp` (MCP). Проверки: `npm test`, `npm run typecheck`, `npm run build`, `npm run check:mcp`. `Start.bat` есть как untracked local file на момент отчёта; его роль нельзя подтвердить как часть проекта.

Game production: Cloudflare Worker `ruleshift`, static assets из `./dist`, config `wrangler.jsonc`; live URL `https://ruleshift.zamusik-play.workers.dev`. Existing Cloudflare Builds: GitHub repo `zamusikmain/ruleshift`, branch `main`, root `/`, build `npm run build`, deploy `npx wrangler deploy` (подтверждено пользователем в истории задачи). MCP — отдельный `ruleshift-mcp`, config `wrangler.mcp.jsonc`, deployed manually; normal game pipeline его не публикует. Docker/Compose/Vercel/uvicorn отсутствуют.

## 16. Git / CI-CD

Repository uses `main` and remote `https://github.com/zamusikmain/ruleshift.git`. Видимые commits: initial release, Cloudflare config, v1.0, gameplay/mobile update, MCP integration, diagnostics. GitHub Actions workflow в repository отсутствует. Cloudflare Workers Builds — внешний CI/CD pipeline для game Worker; его exact execution logs не в repo. MCP deployment был отдельным ручным действием.

## 17. Готовый рассказ на собеседовании

**30 секунд.** «RULESHIFT — браузерная survival-игра на TypeScript и Phaser. В Solo игрок адаптируется к меняющимся правилам, а в Online приватные комнаты работают на Cloudflare Durable Objects и WebSocket: сервер хранит авторитетное состояние, а браузер только отправляет input и рисует snapshots. Я вёл требования, QA и релизные решения, а для реализации использовал AI coding agent и проверял изменения тестами и production smoke-test.»

**1–2 минуты.** «Я сделал RULESHIFT как небольшую browser arcade игру, где основная механика — быстро читать правило и менять поведение: двигаться, остановиться, уйти из зоны, уклониться. Стек — TypeScript, Phaser и Vite на клиенте; Online режим сделан на Cloudflare Workers, Durable Objects и WebSocket. Важный архитектурный момент: правила, движение и состояние комнаты вынесены в shared код. Поэтому Solo использует тот же rule engine, а Online server остаётся авторитетным для HP, коллизий, score и результата. Клиент не может просто прислать себе здоровье или победу.

Также есть отдельный MCP Worker для ограниченного наблюдения за матчами. Он не выдаёт приватные player IDs/tokens, работает через private Service Binding и использует Bearer credentials, роли и rate limit. В production я подтвердил initialize, список tools и read-only calls. Моя роль — требования, продуктовые решения, ручной QA и проверка deploy; для написания и анализа кода я использовал AI agent, поэтому я честно могу объяснить архитектуру и принятые решения, но не говорю, что вручную написал всё один.»

## 18–19. Вопросы и простые ответы

1. **Что это?** Браузерная survival arcade с Solo и закрытым Online Last Alive.
2. **На чём написано?** TypeScript; Phaser/Vite на клиенте, Cloudflare Workers/DO на backend.
3. **Зачем Phaser?** Он даёт game loop и Canvas rendering без собственного движка.
4. **Как создаётся Online room?** Browser делает POST, Worker создаёт code и Durable Object.
5. **Почему DO?** Одна комната имеет одного логического владельца состояния и WebSockets.
6. **Кто считает HP и победителя?** `GameRoom` на сервере, не браузер.
7. **Что отправляет клиент?** Валидный input/actions, а не готовый score/HP.
8. **Как работает reconnect?** Сервер выдаёт token; тот же tab может вернуться в 8-second window.
9. **Что при deploy/restart?** Матч может быть потерян: полный Room не persistится.
10. **Есть ли аккаунты?** Нет, есть local profile и временная room identity.
11. **Где хранится профиль?** В browser local storage.
12. **Есть ли SQL database?** Нет.
13. **Какие правила?** Десять правил с предупреждением, активной фазой и cleanup.
14. **Как сделан mobile input?** Touch joystick с dead zone и обработкой отмены pointer.
15. **Как проверяется безопасность Online?** Protocol validation, origin checks, server authority и message limits.
16. **Что такое MCP здесь?** Отдельный standard protocol endpoint для AI-compatible clients, чтобы читать ограниченное game состояние.
17. **Есть ли LLM в игре?** Нет.
18. **Какие MCP tools доступны?** Шесть read-only: status/config/matches/details/stats/audit.
19. **Почему MCP отдельный Worker?** Чтобы public game path не получал admin/inspection surface и чтобы auth/audit были изолированы.
20. **Как MCP читает игру?** Private same-account Service Binding RPC к named `GameInspection`.
21. **Как защищён MCP?** Hashed Bearer keys, expiry, role, HTTPS, schemas, limits, redaction.
22. **Почему writes выключены?** Production flag false; это ограничивает риск и сохраняет gameplay неизменным.
23. **Как обрабатывается race condition monitoring?** `expectedRevision` и transactional DO mutation.
24. **Сколько тестов?** Подтверждённо 49 Node tests на момент проверки.
25. **Это E2E тесты?** В основном unit/integration-style; real production smoke-test есть для MCP, full browser/device E2E нет.
26. **Главная performance проблема?** Vite предупреждает о большом bundle; нет измеренного latency benchmark.
27. **Как масштабируется?** Room state изолирован по Durable Object, но load/limit measurements не проведены.
28. **Что бы улучшили?** Device QA, load tests, durable recovery or explicit UX around resets, global abuse controls, observability.
29. **Что делали лично вы?** Требования, решения, QA, review и release coordination; AI agent помогал кодом/тестами.
30. **Почему это не назвать production-grade?** Есть production deployment/smoke-test, но отсутствуют доказанные load/SLA/device/security certification и durable match recovery.

## 20. Словарь

| Термин | Простое объяснение | В проекте |
|---|---|---|
| Phaser | Библиотека для браузерной игры | Solo scene/rendering |
| Vite | Инструмент запуска и сборки фронтенда | `npm run dev/build` |
| Worker | Код, выполняемый у Cloudflare | game и MCP backend |
| Durable Object | Объект Cloudflare с одним владельцем состояния | одна room, MCP control |
| WebSocket | Постоянное двустороннее соединение | Online input/snapshots |
| authoritative server | Сервер решает, какое состояние верное | HP, collisions, winner |
| snapshot | Текущее состояние, отправленное клиенту | `state` message |
| interpolation | Плавное дорисовывание между snapshots | Online client |
| rate limit | Ограничение частоты запросов | room create, WS, MCP |
| Service Binding | Приватный вызов Worker-to-Worker | MCP → GameInspection |
| MCP | Protocol для AI-compatible tool clients | `/mcp` |
| Streamable HTTP | HTTP transport MCP | JSON responses over POST |
| Bearer token | Секрет в Authorization header | MCP auth |
| SHA-256 digest | Отпечаток токена вместо хранения токена | `MCP_KEYS` |
| Zod | Проверка формы входных данных | MCP schemas |
| migration | Описание создания DO storage class | Wrangler configs |
| localStorage | Хранилище только в браузере пользователя | profile/settings |
| CORS/Origin | Ограничение browser origin | game/MCP request checks |
| rematch | Новая игра в той же комнате | `Room` state reset |

## 21. Что доучить

**Обязательно:** TypeScript types/modules; browser events and Canvas/Phaser basics; HTTP vs WebSocket; client/server authority; Durable Objects lifecycle; Git commits/branches; читать и запускать tests; объяснить every feature above своими словами.

**Желательно:** Cloudflare deployment/versioning/secrets; rate limiting and origin/CORS; MCP lifecycle (`initialize`, discovery, tool call); concurrency/CAS revision; performance basics (bundle size, tick rate, interpolation); failure modes deployment/reconnect.

**Не нужно глубоко для этого проекта:** SQL/ORM/Alembic, Docker/Kubernetes, Python ML/CV, RAG/vector DB — они здесь не применяются. Не учите их как будто они были использованы.

## 22. Чего нельзя говорить

- «Я вручную написал весь проект один» — это не подтверждено; текущий workflow использует AI agent.
- «Есть AI/LLM/RAG в игре» — нет, есть только MCP interface.
- «Есть PostgreSQL/Redis/SQLite база игроков» — нет.
- «Online полностью production-verified на всех устройствах» — нет; ограничение workerd Windows и device QA зафиксированы.
- «MCP управляет матчем» — production only read-only; writes disabled.
- «Есть OAuth/accounts/JWT» — нет.
- «Высокая нагрузка протестирована» или «SLA» — нет benchmark/load test.
- «Security certified/production-grade» — не подтверждается.

## 23. Resume project card

| Поле | Факт |
|---|---|
| Название | RULESHIFT |
| Тип | Browser survival arcade + private multiplayer + separate Remote MCP monitoring Worker |
| Моя роль | Product owner/reviewer: требования, решения, QA, release coordination; AI-assisted implementation |
| Стек | TypeScript, Phaser 3, Vite, Cloudflare Workers, Durable Objects, WebSocket, MCP SDK, Zod, Node tests |
| Реализовано | Solo rules, local profile/RU-EN/touch, 2–8 Last Alive rooms, authoritative simulation, MCP reads |
| Главная сложность | Разделить shared rules и server authority, обеспечить state lifecycle/validation; изолировать MCP read path |
| Лично | Требования, acceptance/manual production smoke-test, pipeline/deploy decisions; не заявлять ручное авторство всех строк |
| GitHub | `https://github.com/zamusikmain/ruleshift` |
| Live URL | `https://ruleshift.zamusik-play.workers.dev` |

## 24. PROJECT MASTER CONTEXT

```text
PROJECT MASTER CONTEXT — RULESHIFT

Product: RULESHIFT is a dark neon browser survival arcade. The player repeatedly receives a changing rule, sees a warning, adapts movement, avoids hazards, and survives. It has Solo and private 2–8 player Last Alive rooms. Live game URL: https://ruleshift.zamusik-play.workers.dev. Repo: https://github.com/zamusikmain/ruleshift.

Stack: TypeScript, Phaser 3, Vite, HTML/CSS, Web Audio API; Cloudflare Workers + Durable Objects + WebSocket; Wrangler; @modelcontextprotocol/sdk; Zod; Node built-in test runner. No React, Python, SQL DB, Docker, ORM, LLM/RAG/vector DB.

Architecture: Browser client runs Phaser Solo. Shared modules own rules, movement, scoring, protocol and Room state machine. Online browser opens WebSocket to ruleshift Worker. Worker routes /api/rooms and one GameRoom Durable Object owns each room's active in-memory authoritative simulation. The client sends input; server computes health, collisions, rules, score, match phase and winner, broadcasts state snapshots about 20 Hz; client interpolates rendering. Game Room only persists an existence marker, so restart/deploy can reset an active match.

Features: ten rule types with warning/active/recovery; compatible Chaos pairs; modifiers/events; dash, power-ups, directional lasers; score/streak/achievements; RU/EN; local browser profile; keyboard + analog touch joystick; private room creation/join/readiness/countdown/rematch/reconnect.

Game API: POST /api/rooms creates a six-character room code; GET /api/rooms/:code upgrades to WebSocket. WebSocket protocol includes hello, ready, start, input, dash, shockwave, leave and ping. There are no auth/users/admin/incident endpoints and no game account system.

Security/limits: server authority; strict protocol validation; input abuse limits; origin check on game API; room code validation. Reconnect token is generated server-side. Browser profile is local and not tamper-proof. Creation limit is per Worker isolate, not a global anti-abuse service.

MCP: separate deployed Worker ruleshift-mcp endpoint https://ruleshift-mcp.zamusik-play.workers.dev/mcp. Stateless Streamable HTTP with Bearer auth. MCP_KEYS is a Cloudflare Secret containing only token hashes/role/expiry. MCP uses a private same-account Service Binding GAME -> ruleshift#GameInspection. McpControl Durable Object stores bounded monitored room codes, revisions, audit and per-actor limits. Redacted projections omit player names/IDs/tokens/raw snapshots. Currently production MCP_WRITES_ENABLED=false: six discoverable read-only tools are get_game_status, get_game_config, get_active_matches, get_match_details, get_server_stats, get_recent_events. watch_room/unwatch_room exist in code but are disabled and only manage monitoring, never gameplay. No OAuth; clients need custom Bearer header. No global match index, global stats or game event archive.

MCP production verification: Bearer auth, initialize, tools/list, get_game_status, get_game_config, get_active_matches and Service Binding were smoke-tested successfully. This is not proof of all client/device/load/persistence scenarios.

Testing: 49 Node tests cover rules, room state, protocol validation, mobile input, Online client, Worker abuse routes, MCP negotiation/auth/redaction/races. Standard checks: npm test; npm run typecheck; npm run build; npm run check:mcp. Full workerd runtime WebSocket integration could not run locally on Windows due workerd.exe EPERM. Physical device matrix, load/soak, durable restart persistence and MCP write production tests remain unverified.

Deployment: game config wrangler.jsonc deploys ruleshift and Vite dist assets. Cloudflare Builds for main uses npm run build and npx wrangler deploy. MCP uses a different wrangler.mcp.jsonc and separate manual deployment, so ordinary game pipeline does not deploy MCP. No Docker/Vercel/GitHub Actions workflow in repo.

Interesting guarded cases: rematch state reset across cycles; directional/double laser warnings; joystick cancellation; server rejection of spoofed Online state; reconnect grace/host transfer; no private MCP leaks; MCP CAS revision conflicts; invalid MCP keyring diagnostics; no public admin/inspection HTTP route.

Human role: the user is the requirements/product owner/reviewer. Confirmed activities: setting scope, product/deployment decisions, manual QA and production smoke-test, approving commits/pushes. AI coding agent was used for code analysis, implementation, tests, documentation and diagnostics. Git author identity alone does not prove manual authorship. Interview-safe claim: lead requirements, QA and release decisions, used AI-assisted implementation, understand architecture and validation. Do not claim personal hand-writing of all code, AI features in product, SQL database, OAuth/accounts, full device/load verification, or production-grade certification.
```
