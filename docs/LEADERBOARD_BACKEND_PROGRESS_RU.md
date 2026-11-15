# Global Leaderboard backend — локальная реализация

Подготовка реального staging QA: [STAGING_LEADERBOARD_QA_RU.md](STAGING_LEADERBOARD_QA_RU.md). После дополнительного аудита исправлен pair cap при обратной доставке outbox: окно 24 часов и pair_history.played_at теперь используют серверное время settlement, а не finish receipt. Новая проверка: 247/247 тестов. Backend ещё не опубликован, D1 не создана; UI Leaderboard теперь подключён к API; актуальное состояние — [LEADERBOARD_FINAL_PREP_RU.md](LEADERBOARD_FINAL_PREP_RU.md).

Ветка feature/ruleshift-2-chaos-update, protocol v8. Менялись только backend, зависимости, миграции, тесты и документация. Игровые механики и клиентский интерфейс не менялись. Production/staging конфигурации не изменены, удалённые ресурсы и миграции не создавались.

## Аккаунты

worker/accounts.ts использует настоящий @simplewebauthn/server: discoverable passkeys, обязательная user verification, проверка origin/RP ID/challenge/подписи/counter. UUID генерирует сервер; ник не идентификатор. Challenges одноразовые, TTL 300 секунд, связаны с HttpOnly cookie. Сессии — случайные 256-битные токены, только SHA-256 в D1, TTL 7 дней, Secure/HttpOnly/SameSite=Strict cookies. POST требует точный Origin; JSON ограничен 16 KiB. SQL rate limits: 10 auth/30 profile запросов в минуту на origin/IP. Без D1/auth-конфигурации API возвращает 503.

Recovery: восемь 256-битных кодов выдаются один раз, хранятся хеши. Код расходуется атомарно и отзывает сессии; полноценный вход требует регистрации нового passkey. После успешной замены старые credentials и коды удаляются. UUID сохраняется. Logout отзывает сессию. Удаление требует свежей аутентификации (5 минут) и confirm:true: персональные строки удаляются, аккаунт остаётся анонимным deleted tombstone, чтобы поздний outbox не восстановил рейтинг. Технический журнал matches сохраняет UUID матча и hash receipt без ника; pending outbox удаляется после доставки. Отдельный интерфейс добавления второго passkey пока отсутствует; доступны синхронизируемый passkey/cross-device вход и recovery.

## Online и доставка

Gateway удаляет клиентские X-Ruleshift-Account/X-Ruleshift-Session, проверяет cookie и передаёт внутреннему GameRoom подтверждённый UUID и хеш сессии. Данные аккаунта не добавлены в snapshots. Reconnect требует прежний room token и тот же аккаунт. Перед start повторно проверяются сессии. Гостевые комнаты и комнаты с повторяющимся аккаунтом нерейтинговые. Рейтинг получают только матчи 2–8 разных подтверждённых аккаунтов.

worker/roomRankings.ts создаёт новый глобальный UUID на каждый start. GameRoom сериализует команды/тики при включённом рейтинге. Перед рассылкой результатов сохраняет receipt в Durable Object storage outbox. Receipt включает серверные mode/start/end/места/исходы, не принимается через публичный API. Alarms доставляют его в D1, при ошибке повторяют через 30 секунд. Expiry комнаты не удаляет outbox. После перезапуска доставка завершённых матчей возможна без живого Room. Активная игровая симуляция по-прежнему не восстанавливается после перезапуска DO; прерванный до сохранения результатов матч не начисляется.

worker/rankings.ts использует существующую pairwise Elo-формулу v1 (база 1000), с размером матча 2–8 и итоговым местом. Forfeit хуже обычного результата; draw учитывается отдельно. Для Blitz место определяется серверным score, для остальных режимов — авторитетным elimination placement. Общий/по режиму рейтинг записывается в lifetime и месяц UTC начала матча. Для каждой пары за 24 часа вес первых матчей 1, 0.5, 0.25, далее 0; статистика матчей сохраняется даже при нулевом начислении. Это ограничивает повторные пары, но не предотвращает создание множества новых аккаунтов.

Один D1 batch атомарно пишет match, participants, все rating buckets, ledger и pair_history. Глобальная optimistic revision + SQL CHECK guard отвергают конкурентный устаревший расчёт и вызывают retry (до 8 попыток; затем outbox). UUID матча уникален; hash проверяет эквивалентность повторной доставки. Конфликтующий receipt не перезаписывает результаты. Deleted участник делает pending матч void. Сезоны создаются из реальных матчей, архивный статус API определяется UTC-временем. Поздняя доставка относится к исходному месяцу и может обновить его историю; immutable freeze не реализован.

## API

- POST /api/auth/register/options — {name}
- POST /api/auth/register/verify — {response} WebAuthn JSON
- POST /api/auth/login/options — {}
- POST /api/auth/login/verify — {response}
- POST /api/auth/recover — {code}, options замены passkey
- POST /api/auth/logout — {}
- GET /api/account/me — подтверждённый UUID и имя
- POST /api/account/delete — {confirm:true}
- GET /api/leaderboard?mode=overall&season=lifetime — реальные top-100 и me при сессии
- GET /api/leaderboard/me?mode=classic&season=2026-10 — требует сессию, своё место даже вне top-100
- GET /api/leaderboard/seasons — текущий UTC-месяц и история реально созданных сезонов

mode: overall/classic/lastOneStanding/blitz/chaos. season: lifetime или YYYY-MM; default — текущий UTC-месяц. Поля: accountId, name, points, games, wins, losses, draws, winPercent, streak, place. Равные points имеют равное место; порядок выдачи points/games/accountId стабилен. Ошибки машинные, секреты не возвращаются; новый RU/EN UI не добавлен в этой backend-задаче.

## Миграции и запуск

0001 — существующая схема; 0002 — auth context/rate limits/active-account guards; 0003 — settlement revision/transaction guards. Все применяются последовательно. wrangler.leaderboard-local.jsonc — ТОЛЬКО локально; нулевой database_id placeholder. Не публиковать этот файл и не использовать --remote.

```powershell
npm run build
npx wrangler d1 migrations apply ruleshift-rankings-local --local --config wrangler.leaderboard-local.jsonc
npx wrangler dev --local --config wrangler.leaderboard-local.jsonc --ip 127.0.0.1 --port 8787
```

Для WebAuthn открывать http://localhost:8787; RP ID localhost. Сохранять .wrangler между перезапусками. В браузере options/verify нужно связать с navigator.credentials.create/get и преобразованием WebAuthn JSON; отдельный login UI не входит в этот backend-этап.

## Проверки и ограничения

Окончательные проверки: npm test — 246/246, ошибок 0; npm run typecheck — успешно (клиент/Worker/MCP); npm run build — завершён, 48 modules, 4.05 секунды; git diff --check — успешно. Staging Wrangler dry-run и leaderboard-local dry-run — exit 0, Worker 919.65 KiB / gzip 164.31 KiB. Первый build в sandbox получил EPERM realpath; повтор вне sandbox завершён успешно. Сохранилось прежнее предупреждение о размере Phaser chunk. Хеши Start.bat и docs/PROJECT_REPORT_RU.md совпадают с исходными.

Тесты используют реальный SDK, программный P-256 authenticator и ECDSA, SQLite-адаптер D1 и имитацию DO storage/сокетов. Проверены auth replay/signature/origin/UV/TTL/recovery/logout/deletion, HTTP cookies/CSRF, настоящие строки рейтинга через API, конкурентная дедупликация и rollback, transient error/retry/restart outbox, восемь участников/forfeit/reconnect, Rematch UUID, pair cap, UTC seasons, top-100 и своё место вне страницы. Это НЕ настоящий сетевой тест и НЕ Cloudflare D1 integration.

Локальный Wrangler/D1 заблокирован: workerd SQLite GetFinalPathNameByHandleW #5 «Отказано в доступе». Настоящие локальные миграции, Workers crypto, WebSocket+passkeys end-to-end и сохранение после перезапуска Wrangler не подтверждены. Физические passkeys и устройства не проверялись. Staging dry-run проверяет сборку, не выполнение D1.

Для staging потребуются отдельный D1 binding RANKINGS_DB, database_id отдельной базы, migrations_dir, фиксированные AUTH_ORIGIN/RP_ID staging и проверка SDK runtime/nodejs_compat. Создание базы, удалённые миграции и deployment требуют отдельного разрешения. Сначала доказать end-to-end auth → два аккаунта → матч → outbox → рейтинг → перезапуск. При rollout сохранять D1, откатывать код без destructive migration; не выдавать новую базу за продолжение прежнего рейтинга.

Существующий MCP SDK имеет отдельный npm advisory GHSA-6qxp-vccf-f47h; MCP не менялся в этой задаче.

Вердикт: NO-GO как подтверждённый готовый backend staging. Серверные компоненты реализованы и проверяются локальными адаптерными тестами, но критерии настоящего D1/runtime/persistence/browser WebAuthn ещё не выполнены.

