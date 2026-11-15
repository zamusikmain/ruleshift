# RULESHIFT

**Rules change. Survive.**

**[Русский](#русский)** · **[English](#english)**

---

# Русский

**Правила меняются. Выживи.** Тёмная неоновая survival-аркада на TypeScript и Phaser 3. Игрок читает
предупреждение, подстраивается под новое правило и остаётся в живых. Можно играть одному (офлайн-режимы) или с
друзьями в приватной онлайн-комнате на 2–8 игроков.

## 1. Где поиграть

| Окружение | Адрес | Версия |
| --- | --- | --- |
| Production | https://ruleshift.zamusik-play.workers.dev | v1 |
| Staging | https://ruleshift-2-staging.zamusik-play.workers.dev | 2.x (UI, аккаунты, лидерборд) |
| Remote MCP (production) | `https://ruleshift-mcp.zamusik-play.workers.dev/mcp` | только для MCP-клиентов с токеном |

> **Важно.** С 2026-11-15 в `main` лежит код 2.x. Production-конфигурация `wrangler.jsonc` публикует то, что лежит
> в рабочей папке, поэтому `npx wrangler deploy` из `main` выкатит 2.x в production. Делайте это только после QA.

## 2. Возможности

**Игра**

- 10 базовых правил с фазами «предупреждение → активная фаза → восстановление», без повторов подряд.
- Дополнительные опасности 2.x: лазерные сетки, «взрывы», перекрёстный огонь, обрушение пола, импульсы, рои плиток,
  Overdrive-окна по серверным часам; разрешённые Chaos-пары и тройки.
- 3 HP, секунда неуязвимости после урона, очки за выживание и бонус серии чистых правил до ×5.
- Способности и усиления: Dash, Shield, Speed, Pulse.
- **Офлайн-режимы:** Classic, Survival (без лимита времени), Blitz (90 с), Chaos, Daily (90 с, сид от даты UTC).
- **Онлайн-режимы:** Classic, Last One Standing, Blitz, Chaos — комнаты на 2–8 игроков по шестизначному коду,
  rematch в том же лобби.
- Профиль на четыре вкладки, локальные XP, 17 достижений, личные рекорды, история Daily.
- **Аккаунты (2.x, staging):** вход через Google, email-код, passkeys (WebAuthn) с recovery-кодами, гостевой режим;
  выбор ника.
- **Глобальный лидерборд (2.x, staging):** рейтинг по режимам, lifetime и сезоны UTC, своё место.
- Английский и русский интерфейс; клавиатура и аналоговый тач-джойстик (размер 104–168 px).
- Процедурная графика и синтезированный звук — без скачанных ассетов.
- Отдельный Remote MCP-сервер для наблюдения за комнатами.

## 3. Стек технологий

| Слой | Технологии |
| --- | --- |
| Язык | TypeScript 5.9 (клиент, Workers, MCP), немного JavaScript (тесты, скрипты) |
| Клиент | Phaser 3.90 (canvas, игровой цикл), Vite 7, DOM-интерфейс + CSS, Web Audio API, Pointer Events, localStorage |
| Сервер | Cloudflare Workers, Durable Objects (`GameRoom` — комната, `McpControl` — MCP), WebSockets |
| База данных | Cloudflare D1 (SQLite) — аккаунты, сессии, рейтинги (`migrations/leaderboard/`) |
| Аутентификация | `@simplewebauthn/server` (passkeys), `jose` (JWT/OAuth Google), email-коды через Resend, HttpOnly-cookie `__Host-` |
| MCP | `@modelcontextprotocol/sdk` (stateless Streamable HTTP), Zod (валидация) |
| Деплой | Wrangler 4 |
| Тесты | Node built-in test runner (34 файла `tests/*.test.mjs`), smoke-тест онлайна, визуальный тест |

## 4. Архитектура

```text
Офлайн-игрок ──> Vite/Phaser клиент ──> общая игровая логика (src/shared) в браузере

Онлайн-игрок ──> WebSocket ──> Worker ruleshift (/api/rooms)
                                 └> Durable Object GameRoom — авторитетная симуляция комнаты
                                      └> по итогам матча — запись результата в D1 (рейтинг)

Аккаунт ──> /api/auth/*, /api/account/*, /api/leaderboard ──> D1 (accounts, sessions, ratings…)

MCP-клиент ──> Worker ruleshift-mcp (/mcp, Bearer-токен)
                 ├> Durable Object McpControl (наблюдение, лимиты, аудит)
                 └> приватный Service Binding ──> ruleshift#GameInspection ──> GameRoom.inspect()
```

- `src/shared/` — бизнес-правила без Phaser и Cloudflare: движение, правила, опасности, комната, протокол,
  рейтинг. Один и тот же код работает в офлайне (в браузере) и на сервере (в Durable Object).
- Сервер владеет движением, HP, коллизиями, выбыванием, выбором правил, таймингом и победителем. Клиент шлёт
  нормализованный ввод 20 раз в секунду и получает снимки 20 раз в секунду; клиентской власти над очками и HP нет.
- Сетевой протокол — версия 8 (снимки несут несколько слоёв угроз).

## 5. Структура проекта

```text
src/
  main.ts, config.ts       точка входа и настройки
  scenes/ArenaScene.ts     офлайн-игра, переходы меню, эффекты
  arena.ts, player.ts, playerView.ts, ruleView.ts, effects.ts   отрисовка
  input.ts, controlSettings.ts   клавиатура + джойстик → нормализованный ввод
  rules.ts                 офлайн-адаптер общего движка правил
  shared/                  ruleEngine, variants, modes, movement, room, protocol, identity, scoring,
                           pickups, progression, offlineProgress, rating, leaderboardContract,
                           опасности: laserHazards, burstHazards, crossfire, collapse, pulse,
                           swarmTiles, overdriveHazards, comboSafety
  online/client.ts         UI комнаты, WebSocket, снимки, интерполяция
  authEntry.ts, accountView.ts, accountProfile.ts   вход и аккаунт
  leaderboardApi.ts, leaderboardView.ts             лидерборд
  ui.ts, uiModel.ts, hud.ts, featureView.ts         экраны и HUD
  profile.ts, storage.ts   локальный профиль, миграции, статистика, достижения
  audio.ts, device.ts      синтез звука, ориентация экрана
  locales/                 словари EN/RU
worker/
  index.ts                 HTTP-маршруты + Durable Object GameRoom
  accountApi.ts, accounts.ts, simpleAuth.ts, authFailure.ts   аккаунты, passkeys, Google, email
  rankings.ts, roomRankings.ts   рейтинги и запись результатов матчей
  observability.ts         приватный GameInspection для MCP
  staging-retired.ts       заглушка для выведенного staging
mcp/                       Remote MCP: index, server, auth, contracts, control
migrations/leaderboard/    SQL-миграции D1 (0001–0004)
scripts/                   mcp-client.mjs, auth-diagnostics.mjs, leaderboard-browser-qa.js
tests/                     тесты правил, режимов, протокола, комнаты, Worker, аккаунтов, рейтинга, UI
docs/                      отчёты по этапам, QA, staging, MCP, архитектура лидерборда
wrangler.jsonc             production-игра
wrangler.staging.jsonc, wrangler.staging-leaderboard.jsonc, wrangler.staging-retire.jsonc   staging
wrangler.leaderboard-local.jsonc   локальная D1
wrangler.mcp.jsonc         MCP Worker
Start.bat                  локальный запуск (Windows)
```

## 6. Данные

**D1 (только при подключённой базе `RANKINGS_DB`):**

| Таблица | Что хранит |
| --- | --- |
| `accounts` | Аккаунт: UUID, отображаемое имя (ник), даты |
| `credentials` | Публичные ключи passkeys |
| `sessions` | Сессии (хеши токенов) |
| `auth_challenges` | Одноразовые WebAuthn-челленджи |
| `recovery_codes` | Хеши кодов восстановления |
| `auth_identities` | Привязанные способы входа (Google, email) |
| `login_flows` | Незавершённые входы через Google/email-код |
| `account_nickname_choices` | Отметки выбора ника и лимит смены |
| `seasons` | Сезоны рейтинга (UTC) |
| `matches`, `participants` | Сыгранные матчи и их участники |
| `ratings` | Рейтинг по режиму × (lifetime / сезон) |
| `settlement_ledger`, `settlement_revision`, `settlement_guard` | Журнал начисления рейтинга (идемпотентность) |
| `pair_history` | История пар игроков (защита от фарма) |
| `request_limits` | Лимиты запросов |

**Durable Objects:** `GameRoom` держит матч в памяти (в хранилище — только отметка существования и alarm);
`McpControl` хранит ревизию, до 20 наблюдаемых комнат, до 100 событий аудита и лимиты.

**Браузер:** `ruleshift.profile.v1` (имя, цвет, рекорды, достижения, офлайн-прогресс), `ruleshift.language`,
настройки звука и джойстика (`ruleshift.controls.v1`, `ruleshift.joystick-pixels.v1`). Локальные данные не
защищены от подделки и не дают глобального рейтинга.

## 7. API

| Группа | Метод и путь | Назначение |
| --- | --- | --- |
| Комнаты | `POST /api/rooms` | Создать комнату, вернуть код (проверка origin, 12 созданий в минуту) |
| Комнаты | `GET /api/rooms/:code` + WebSocket Upgrade | Подключиться к комнате |
| Протокол | WebSocket: `hello`, `ready`, `start`, `input`, `dash`, `shockwave`, `leave`, `ping` | Действия игрока, строгая валидация, лимит 70 сообщений/с |
| Вход | `GET /api/auth/providers` | Какие способы входа включены |
| Вход | `GET /api/auth/google/start`, `GET /api/auth/google/callback` | Вход через Google |
| Вход | `POST /api/auth/email/start`, `POST /api/auth/email/verify` | Вход по коду на email |
| Вход | `POST /api/auth/register/options`, `/register/verify`, `/login/options`, `/login/verify` | Passkeys |
| Вход | `POST /api/auth/recover`, `POST /api/auth/logout` | Восстановление и выход |
| Аккаунт | `GET /api/account/me`, `POST /api/account/nickname`, `POST /api/account/delete` | Профиль, ник, удаление |
| Лидерборд | `GET /api/leaderboard`, `GET /api/leaderboard/me`, `GET /api/leaderboard/seasons` | Таблица, своё место, сезоны |
| MCP | `POST /mcp` (отдельный Worker) | JSON-RPC: initialize, tools/list, tools/call |

**MCP-инструменты (только чтение):** `get_game_status`, `get_active_matches`, `get_match_details`,
`get_game_config`, `get_server_stats`, `get_recent_events`. Запись (`watch_room`, `unwatch_room`) — только для
operator-токена и при `MCP_WRITES_ENABLED=true` (в production — `false`). Подробно: [docs/MCP.md](docs/MCP.md).

## 8. Конфигурация и секреты

| Имя | Где | Назначение |
| --- | --- | --- |
| `ROOMS` | binding | Durable Object `GameRoom` |
| `ASSETS` | binding | Статика из `dist/` |
| `RANKINGS_DB` | binding D1 | База аккаунтов и рейтинга (без неё аккаунты и лидерборд выключены) |
| `AUTH_ORIGIN`, `AUTH_RP_ID` | vars | Origin и RP ID для passkeys и OAuth |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | секреты | Вход через Google |
| `RESEND_API_KEY`, `EMAIL_FROM` | секреты / vars | Отправка email-кодов |
| `AUTH_CODE_SECRET` | секрет | Подпись email-кодов (≥ 32 случайных байт) |
| `MCP_KEYS` | секрет MCP Worker | Хеши Bearer-токенов MCP |
| `MCP_WRITES_ENABLED` | var MCP Worker | Разрешить запись (по умолчанию `false`) |

Секреты задаются через `npx wrangler secret put`, в файлах их нет. Подготовка: [docs/SIMPLE_AUTH_PREPARATION_RU.md](docs/SIMPLE_AUTH_PREPARATION_RU.md).

## 9. Как играть

### Правила

| Правило | Что делать |
| --- | --- |
| Keep Moving | Не стоять на месте 1,2 с (упор в стену не считается) |
| Danger Zones | Уйти из отмеченных кругов до конца 1,5-секундного предупреждения |
| Center Now | Добежать до центра за 4 с (3,5 на Hard) |
| Dodge | Уклоняться от снарядов, летящих туда, где игрок был при их появлении |
| Don't Move | Подготовка 1,8 с, замереть на 2 с, ждать отпускания |
| Laser Sweep | Увернуться от опускающегося луча через зазоры по краям |
| Shrinking Arena | Оставаться внутри сужающейся границы |
| Hunter | Держаться подальше от медленного преследователя |
| Meteor Shower | Уйти из отмеченных кругов за 1,25 с до удара |
| Symbol Match | Добраться до зоны I / II / III (символы дополняют цвет) |

Цикл: анонс → 4–6 с активной фазы → восстановление. Очки: +10 в секунду, за чистое правило — `100 × min(серия, 5)`.
Нарушение сбрасывает серию.

### Режимы

| Режим | Где | Особенности |
| --- | --- | --- |
| Classic | офлайн и онлайн | Базовый темп |
| Survival | офлайн | Без лимита времени, растущая сложность |
| Blitz | офлайн и онлайн | 90 секунд, короткие паузы |
| Chaos | офлайн и онлайн | Комбинации правил с самого начала |
| Daily | офлайн | 90 с, одинаковый для всех сценарий дня (сид от даты UTC), локальная медаль |
| Last One Standing | онлайн | Побеждает последний выживший |

### Онлайн

Создайте комнату, поделитесь кодом из шести символов. Хост запускает матч, когда готовы 2–8 игроков. Выбывшие
становятся зрителями. Отключившийся игрок может вернуться в той же вкладке за 8 секунд. Пустые комнаты живут
15 минут, матч — не дольше 10 минут.

### Управление

| Действие | Управление |
| --- | --- |
| Движение | WASD, стрелки или тач-джойстик |
| Пауза (офлайн) | Escape или кнопка паузы |
| Выйти из комнаты | Кнопка × или «Покинуть комнату» |
| Язык, звук, джойстик | Меню или настройки профиля |

## 10. Установка и запуск

Нужен Node.js 22.12+ (проверялось на Node 24).

```sh
npm ci
npm run dev          # офлайн и UI: http://127.0.0.1:5173
```

Полное приложение с онлайн-комнатами (локальный Cloudflare runtime):

```sh
npm run build
npm run dev:online   # http://127.0.0.1:8787, откройте в двух окнах
```

Локально с аккаунтами и рейтингом — конфигурация `wrangler.leaderboard-local.jsonc` (локальная D1).
MCP локально: `npm run dev:mcp` (порт 8788). На Windows можно запустить `Start.bat`.

## 11. Проверки и тесты

```sh
npm test               # unit-тесты (node --test tests/*.test.mjs)
npm run typecheck      # клиент, Worker и MCP
npm run build
npx wrangler deploy --dry-run
npm run check:mcp      # сборка MCP Worker без публикации
npm run test:online    # при запущенном dev:online — реальный HTTP/WebSocket smoke-тест
```

Тесты покрывают правила и опасности, режимы, комбинации, протокол, комнату, Worker, аккаунты, passkeys,
email/Google-вход, рейтинг и settlement, офлайн-прогресс, UI-модели, джойстик, MCP.

## 12. Деплой

- **Production:** `npx wrangler deploy` (конфигурация `wrangler.jsonc`, Worker `ruleshift`). Только после
  `npm ci`, `npm test`, `npm run build`, dry-run и QA на устройствах.
- **Staging:** `wrangler.staging-leaderboard.jsonc` (Worker `ruleshift-2-staging`, своя D1
  `ruleshift-2-staging-rankings`). Порядок, откат и удаление: [docs/STAGING.md](docs/STAGING.md),
  [docs/STAGING_LEADERBOARD_DEPLOYMENT_RU.md](docs/STAGING_LEADERBOARD_DEPLOYMENT_RU.md).
- **MCP:** `npx wrangler deploy --config wrangler.mcp.jsonc` — отдельно от игры.

## 13. Ветки и статус

| Ветка | Что в ней |
| --- | --- |
| `main` | **Актуальный код 2.x** (2026-11-15 в него влита `feature/ruleshift-2-chaos-update`) |
| `feature/ruleshift-2-chaos-update` | Совпадает с `main` |

**Статус:**

- Production работает на v1.
- Staging: UI 2.x, аккаунты (Google, passkeys) и лидерборд проверены реальными матчами Blitz, Chaos и
  Last One Standing (2026-10-10, [docs/FINAL_STAGING_HARDENING_RU.md](docs/FINAL_STAGING_HARDENING_RU.md)).
- Локально, ещё не на staging: исправление раннего завершения Blitz, email-вход и выбор ника (миграция
  `0004_simple_auth.sql`), Overdrive (протокол v8), регулировка джойстика.
- Этап 5 Overdrive не завершён: Phase, Magnet, Perfect Dodge, Risk Zones, Bonus Rush, Clutch Save не реализованы.

## 14. Планы

- [ ] Применить миграцию `0004` на staging, задать секреты Google/Resend, выкатить и перепроверить Blitz.
- [ ] Пройти QA на физических устройствах (Android, iPhone, iPad), мультитач и FPS.
- [ ] Завершить этап 5 Overdrive (новые способности и события).
- [ ] Выпустить 2.x в production: production D1, секреты, деплой.
- [ ] Балансировка сложности по итогам плейтестов.

## 15. Ограничения

- Комнаты эфемерны: перезапуск или деплой Durable Object завершает матчи.
- Переподключение — только та же вкладка в течение 8 секунд.
- Нет предсказания на клиенте и компенсации задержки.
- Лимит создания комнат — на изолят Worker, а не глобальный.
- Локальная статистика не защищена от подделки.
- Реальная работа на телефонах и планшетах проверена не полностью.

---

# English

**Rules change. Survive.** A dark neon survival arcade built with TypeScript and Phaser 3. Read the warning, adapt to
the next rule and stay alive. Play alone (offline modes) or with friends in a private online room for 2–8 players.

## 1. Where to play

| Environment | Address | Version |
| --- | --- | --- |
| Production | https://ruleshift.zamusik-play.workers.dev | v1 |
| Staging | https://ruleshift-2-staging.zamusik-play.workers.dev | 2.x (UI, accounts, leaderboard) |
| Remote MCP (production) | `https://ruleshift-mcp.zamusik-play.workers.dev/mcp` | MCP clients with a token only |

> **Important.** Since 2026-11-15 `main` contains the 2.x code. The production config `wrangler.jsonc` publishes
> whatever is in the working folder, so `npx wrangler deploy` from `main` ships 2.x to production. Only do that
> after QA.

## 2. Features

**Game**

- 10 base rules with "warning → active → recovery" phases and no immediate repeats.
- 2.x hazards: laser grids, bursts, crossfire, floor collapse, pulses, tile swarms, Overdrive windows on the server
  clock; approved Chaos pairs and triples.
- 3 HP, one second of immunity after damage, survival score and a clean-rule streak bonus up to ×5.
- Abilities and power-ups: Dash, Shield, Speed, Pulse.
- **Offline modes:** Classic, Survival (no time limit), Blitz (90 s), Chaos, Daily (90 s, seed from the UTC date).
- **Online modes:** Classic, Last One Standing, Blitz, Chaos — rooms for 2–8 players by a six-character code,
  rematch in the same lobby.
- Four-tab profile, local XP, 17 achievements, personal records, Daily history.
- **Accounts (2.x, staging):** Google sign-in, email code, passkeys (WebAuthn) with recovery codes, guest mode;
  nickname choice.
- **Global leaderboard (2.x, staging):** ratings per mode, lifetime and UTC seasons, your own place.
- English and Russian UI; keyboard and analog touch joystick (104–168 px).
- Procedural visuals and synthesized sound — no downloaded assets.
- A separate Remote MCP server for monitoring rooms.

## 3. Tech stack

| Layer | Technologies |
| --- | --- |
| Language | TypeScript 5.9 (client, Workers, MCP), some JavaScript (tests, scripts) |
| Client | Phaser 3.90 (canvas, game loop), Vite 7, DOM UI + CSS, Web Audio API, Pointer Events, localStorage |
| Server | Cloudflare Workers, Durable Objects (`GameRoom` — a room, `McpControl` — MCP), WebSockets |
| Database | Cloudflare D1 (SQLite) — accounts, sessions, ratings (`migrations/leaderboard/`) |
| Authentication | `@simplewebauthn/server` (passkeys), `jose` (JWT/Google OAuth), email codes via Resend, `__Host-` HttpOnly cookie |
| MCP | `@modelcontextprotocol/sdk` (stateless Streamable HTTP), Zod (validation) |
| Deployment | Wrangler 4 |
| Tests | Node built-in test runner (34 `tests/*.test.mjs` files), online smoke test, visual test |

## 4. Architecture

```text
Offline player ──> Vite/Phaser client ──> shared game logic (src/shared) in the browser

Online player ──> WebSocket ──> ruleshift Worker (/api/rooms)
                                 └> GameRoom Durable Object — authoritative room simulation
                                      └> after a match — result written to D1 (rating)

Account ──> /api/auth/*, /api/account/*, /api/leaderboard ──> D1 (accounts, sessions, ratings…)

MCP client ──> ruleshift-mcp Worker (/mcp, Bearer token)
                 ├> McpControl Durable Object (monitoring, limits, audit)
                 └> private Service Binding ──> ruleshift#GameInspection ──> GameRoom.inspect()
```

- `src/shared/` holds business rules with no Phaser or Cloudflare dependency: movement, rules, hazards, room,
  protocol, rating. The same code runs offline (in the browser) and on the server (in a Durable Object).
- The server owns movement, HP, collisions, elimination, rule selection, timing and the winner. Clients send
  normalized input at 20 Hz and receive snapshots at 20 Hz; clients have no authority over score or HP.
- Network protocol version 8 (snapshots carry several threat layers).

## 5. Project structure

```text
src/
  main.ts, config.ts       entry point and settings
  scenes/ArenaScene.ts     offline game, menu transitions, effects
  arena.ts, player.ts, playerView.ts, ruleView.ts, effects.ts   rendering
  input.ts, controlSettings.ts   keyboard + joystick → normalized input
  rules.ts                 offline adapter for the shared rule engine
  shared/                  ruleEngine, variants, modes, movement, room, protocol, identity, scoring,
                           pickups, progression, offlineProgress, rating, leaderboardContract,
                           hazards: laserHazards, burstHazards, crossfire, collapse, pulse,
                           swarmTiles, overdriveHazards, comboSafety
  online/client.ts         room UI, WebSocket, snapshots, interpolation
  authEntry.ts, accountView.ts, accountProfile.ts   sign-in and account
  leaderboardApi.ts, leaderboardView.ts             leaderboard
  ui.ts, uiModel.ts, hud.ts, featureView.ts         screens and HUD
  profile.ts, storage.ts   local profile, migrations, statistics, achievements
  audio.ts, device.ts      sound synthesis, screen orientation
  locales/                 EN/RU dictionaries
worker/
  index.ts                 HTTP routing + GameRoom Durable Object
  accountApi.ts, accounts.ts, simpleAuth.ts, authFailure.ts   accounts, passkeys, Google, email
  rankings.ts, roomRankings.ts   ratings and match result recording
  observability.ts         private GameInspection for MCP
  staging-retired.ts       stub for a retired staging
mcp/                       Remote MCP: index, server, auth, contracts, control
migrations/leaderboard/    D1 SQL migrations (0001–0004)
scripts/                   mcp-client.mjs, auth-diagnostics.mjs, leaderboard-browser-qa.js
tests/                     rules, modes, protocol, room, Worker, accounts, rating, UI tests
docs/                      stage reports, QA, staging, MCP, leaderboard architecture
wrangler.jsonc             production game
wrangler.staging.jsonc, wrangler.staging-leaderboard.jsonc, wrangler.staging-retire.jsonc   staging
wrangler.leaderboard-local.jsonc   local D1
wrangler.mcp.jsonc         MCP Worker
Start.bat                  local launcher (Windows)
```

## 6. Data

**D1 (only when the `RANKINGS_DB` database is bound):**

| Table | Contents |
| --- | --- |
| `accounts` | Account: UUID, display name (nickname), dates |
| `credentials` | Passkey public keys |
| `sessions` | Sessions (token hashes) |
| `auth_challenges` | Single-use WebAuthn challenges |
| `recovery_codes` | Recovery code hashes |
| `auth_identities` | Linked sign-in methods (Google, email) |
| `login_flows` | Pending Google/email-code sign-ins |
| `account_nickname_choices` | Nickname choice markers and change limit |
| `seasons` | Rating seasons (UTC) |
| `matches`, `participants` | Played matches and their participants |
| `ratings` | Rating per mode × (lifetime / season) |
| `settlement_ledger`, `settlement_revision`, `settlement_guard` | Rating settlement ledger (idempotency) |
| `pair_history` | Player pair history (anti-farming) |
| `request_limits` | Request limits |

**Durable Objects:** `GameRoom` keeps the match in memory (storage holds only an existence marker and an alarm);
`McpControl` stores a revision, up to 20 monitored rooms, up to 100 audit events and limits.

**Browser:** `ruleshift.profile.v1` (name, color, records, achievements, offline progress), `ruleshift.language`,
sound and joystick settings (`ruleshift.controls.v1`, `ruleshift.joystick-pixels.v1`). Local data is not
tamper-proof and gives no global rating.

## 7. API

| Group | Method and path | Purpose |
| --- | --- | --- |
| Rooms | `POST /api/rooms` | Create a room, return the code (origin check, 12 creations per minute) |
| Rooms | `GET /api/rooms/:code` + WebSocket Upgrade | Join a room |
| Protocol | WebSocket: `hello`, `ready`, `start`, `input`, `dash`, `shockwave`, `leave`, `ping` | Player actions, strict validation, 70 messages/s limit |
| Sign-in | `GET /api/auth/providers` | Which sign-in methods are enabled |
| Sign-in | `GET /api/auth/google/start`, `GET /api/auth/google/callback` | Google sign-in |
| Sign-in | `POST /api/auth/email/start`, `POST /api/auth/email/verify` | Email code sign-in |
| Sign-in | `POST /api/auth/register/options`, `/register/verify`, `/login/options`, `/login/verify` | Passkeys |
| Sign-in | `POST /api/auth/recover`, `POST /api/auth/logout` | Recovery and sign-out |
| Account | `GET /api/account/me`, `POST /api/account/nickname`, `POST /api/account/delete` | Profile, nickname, deletion |
| Leaderboard | `GET /api/leaderboard`, `GET /api/leaderboard/me`, `GET /api/leaderboard/seasons` | Table, your place, seasons |
| MCP | `POST /mcp` (separate Worker) | JSON-RPC: initialize, tools/list, tools/call |

**MCP tools (read-only):** `get_game_status`, `get_active_matches`, `get_match_details`, `get_game_config`,
`get_server_stats`, `get_recent_events`. Writes (`watch_room`, `unwatch_room`) need an operator token and
`MCP_WRITES_ENABLED=true` (`false` in production). Details: [docs/MCP.md](docs/MCP.md).

## 8. Configuration and secrets

| Name | Where | Purpose |
| --- | --- | --- |
| `ROOMS` | binding | `GameRoom` Durable Object |
| `ASSETS` | binding | Static files from `dist/` |
| `RANKINGS_DB` | D1 binding | Accounts and rating database (without it accounts and leaderboard are off) |
| `AUTH_ORIGIN`, `AUTH_RP_ID` | vars | Origin and RP ID for passkeys and OAuth |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secrets | Google sign-in |
| `RESEND_API_KEY`, `EMAIL_FROM` | secret / var | Email code delivery |
| `AUTH_CODE_SECRET` | secret | Email code signing (≥ 32 random bytes) |
| `MCP_KEYS` | MCP Worker secret | MCP Bearer token hashes |
| `MCP_WRITES_ENABLED` | MCP Worker var | Allow writes (default `false`) |

Secrets are set with `npx wrangler secret put`; none are in files. Preparation:
[docs/SIMPLE_AUTH_PREPARATION_RU.md](docs/SIMPLE_AUTH_PREPARATION_RU.md).

## 9. How to play

### Rules

| Rule | What to do |
| --- | --- |
| Keep Moving | Do not stand still for 1.2 s (pushing against a wall does not count) |
| Danger Zones | Leave the marked circles before the 1.5-second warning ends |
| Center Now | Reach the center within 4 s (3.5 on Hard) |
| Dodge | Avoid projectiles aimed where a player was when they spawned |
| Don't Move | Prepare 1.8 s, freeze 2 s, wait for release |
| Laser Sweep | Avoid a descending beam using the gaps at its ends |
| Shrinking Arena | Stay inside the contracting border |
| Hunter | Keep away from a slower pursuer |
| Meteor Shower | Leave targeted circles 1.25 s before impact |
| Symbol Match | Reach the requested I / II / III zone (symbols supplement color) |

Cycle: announcement → 4–6 active seconds → recovery. Score: +10 per second, a clean rule gives
`100 × min(streak, 5)`. A violation resets the streak.

### Modes

| Mode | Where | Notes |
| --- | --- | --- |
| Classic | offline and online | Base pace |
| Survival | offline | No time limit, rising difficulty |
| Blitz | offline and online | 90 seconds, short rests |
| Chaos | offline and online | Rule combinations from the start |
| Daily | offline | 90 s, the same daily course for everyone (UTC date seed), local medal |
| Last One Standing | online | Last survivor wins |

### Online

Create a room and share its six-character code. The host starts when 2–8 players are ready. Eliminated players
spectate. A disconnected player can return in the same tab within 8 seconds. Idle rooms live 15 minutes; a match lasts
at most 10 minutes.

### Controls

| Action | Control |
| --- | --- |
| Move | WASD, arrow keys or touch joystick |
| Pause (offline) | Escape or the pause button |
| Leave a room | The × button or "Leave Room" |
| Language, sound, joystick | Menu or profile settings |

## 10. Setup and launch

Requires Node.js 22.12+ (checked on Node 24).

```sh
npm ci
npm run dev          # offline and UI: http://127.0.0.1:5173
```

Full app with online rooms (local Cloudflare runtime):

```sh
npm run build
npm run dev:online   # http://127.0.0.1:8787, open in two windows
```

Locally with accounts and ratings use `wrangler.leaderboard-local.jsonc` (local D1). MCP locally: `npm run dev:mcp`
(port 8788). On Windows you can run `Start.bat`.

## 11. Checks and tests

```sh
npm test               # unit tests (node --test tests/*.test.mjs)
npm run typecheck      # client, Worker and MCP
npm run build
npx wrangler deploy --dry-run
npm run check:mcp      # MCP Worker bundle without publishing
npm run test:online    # with dev:online running — real HTTP/WebSocket smoke test
```

Tests cover rules and hazards, modes, combinations, the protocol, the room, the Worker, accounts, passkeys,
email/Google sign-in, rating and settlement, offline progress, UI models, the joystick and MCP.

## 12. Deployment

- **Production:** `npx wrangler deploy` (`wrangler.jsonc`, Worker `ruleshift`). Only after `npm ci`, `npm test`,
  `npm run build`, a dry run and device QA.
- **Staging:** `wrangler.staging-leaderboard.jsonc` (Worker `ruleshift-2-staging`, its own D1
  `ruleshift-2-staging-rankings`). Procedure, rollback and teardown: [docs/STAGING.md](docs/STAGING.md),
  [docs/STAGING_LEADERBOARD_DEPLOYMENT_RU.md](docs/STAGING_LEADERBOARD_DEPLOYMENT_RU.md).
- **MCP:** `npx wrangler deploy --config wrangler.mcp.jsonc` — separate from the game.

## 13. Branches and status

| Branch | Contents |
| --- | --- |
| `main` | **Current 2.x code** (`feature/ruleshift-2-chaos-update` merged in on 2026-11-15) |
| `feature/ruleshift-2-chaos-update` | Same as `main` |

**Status:**

- Production runs v1.
- Staging: 2.x UI, accounts (Google, passkeys) and leaderboard verified with real Blitz, Chaos and Last One Standing
  matches (2026-10-10, [docs/FINAL_STAGING_HARDENING_RU.md](docs/FINAL_STAGING_HARDENING_RU.md)).
- Local only, not yet on staging: the early Blitz end fix, email sign-in and nickname choice (migration
  `0004_simple_auth.sql`), Overdrive (protocol v8), joystick size slider.
- Overdrive stage 5 is unfinished: Phase, Magnet, Perfect Dodge, Risk Zones, Bonus Rush and Clutch Save are not
  implemented.

## 14. Roadmap

- [ ] Apply migration `0004` on staging, set Google/Resend secrets, deploy and re-test Blitz.
- [ ] QA on physical devices (Android, iPhone, iPad), multitouch and FPS.
- [ ] Finish Overdrive stage 5 (new abilities and events).
- [ ] Ship 2.x to production: production D1, secrets, deploy.
- [ ] Balance difficulty from playtests.

## 15. Limitations

- Rooms are ephemeral: a Durable Object restart or deploy ends matches.
- Reconnect works only in the same tab within 8 seconds.
- No client prediction or lag compensation.
- Room creation throttling is per Worker isolate, not global.
- Local statistics are not tamper-proof.
- Real phone and tablet behavior is not fully verified.
