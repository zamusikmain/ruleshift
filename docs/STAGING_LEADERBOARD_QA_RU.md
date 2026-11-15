# Актуализация

UI и passkeys подключены, interrupted journal и отзыв Online-сессий реализованы, ошибки D1 выделены в 503. Текущая контрольная точка: [LEADERBOARD_FINAL_PREP_RU.md](LEADERBOARD_FINAL_PREP_RU.md). Ниже сохранён первоначальный план; команды ресурсов/миграций/rollback актуальны, старые указания о неподключённом UI и нереализованном interrupted относятся к предыдущему этапу.

# Staging Leaderboard: план интеграционного QA

Дата подготовки: 2026-10-10. Ветка feature/ruleshift-2-chaos-update, protocol v8. Ни одна команда удалённой записи ниже не выполнена. Опубликованный staging и production не изменены.

## Ресурсы и конфигурация

Подготовлен wrangler.staging-leaderboard.jsonc. Worker ruleshift-2-staging; URL https://ruleshift-2-staging.zamusik-play.workers.dev. Это адрес существующего staging, а не утверждение о работающем новом backend.

Bindings:
- ROOMS -> GameRoom внутри ruleshift-2-staging, прежняя SQL DO migration v1. Нет script_name production и нет новых/удаляемых DO классов.
- RANKINGS_DB -> новая D1 ruleshift-2-staging-rankings; database_id пока нулевой placeholder, заменить только UUID созданной staging базы.
- ASSETS -> ./dist.
- AUTH_ORIGIN -> https://ruleshift-2-staging.zamusik-play.workers.dev.
- AUTH_RP_ID -> ruleshift-2-staging.zamusik-play.workers.dev (без https и пути).
- nodejs_compat включён для WebAuthn SDK. routes пуст; preview_urls false.

Существующие wrangler.jsonc/wrangler.staging.jsonc/wrangler.mcp.jsonc не менялись. Нет production D1, KV/R2 или Service Binding на production. Сессии и passkeys привязаны к staging host; __Host- cookie без Domain не переносится на production. Отдельный auth secret не нужен: passkeys хранят публичные ключи, сессии/recovery используют random tokens и hashes. Cloudflare API token нужен только оператору Wrangler, не Worker binding. Аккаунт Cloudflare и доступность имени D1 ещё не проверялись удалённо.

## Команды — только после разрешения

Рабочая папка — корень RULESHIFT. Не использовать production конфигурацию. Сначала проверить активный аккаунт и записать текущую staging Version ID:

```powershell
npx wrangler whoami
npx wrangler versions list --config wrangler.staging.jsonc
npx wrangler deployments list --config wrangler.staging.jsonc
```

Создание отдельной D1 (удалённая запись):

```powershell
npx wrangler d1 create ruleshift-2-staging-rankings --config wrangler.staging-leaderboard.jsonc --update-config=false
```

Автоматическое изменение конфигурации выключено. Вручную заменить только database_id RANKINGS_DB в wrangler.staging-leaderboard.jsonc выданным UUID. Сверить UUID и account; не копировать UUID production и не оставлять placeholder. Если база с таким именем уже есть, остановиться и проверить происхождение, не применять миграции к неизвестной базе.

Проверка и применение миграций (apply — удалённая запись):

```powershell
npx wrangler d1 info ruleshift-2-staging-rankings --config wrangler.staging-leaderboard.jsonc
npx wrangler d1 migrations list ruleshift-2-staging-rankings --remote --config wrangler.staging-leaderboard.jsonc
npx wrangler d1 migrations apply ruleshift-2-staging-rankings --remote --config wrangler.staging-leaderboard.jsonc
npx wrangler d1 execute ruleshift-2-staging-rankings --remote --config wrangler.staging-leaderboard.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name; SELECT * FROM d1_migrations; PRAGMA foreign_key_check;"
```

Порядок: 0001_accounts_ratings.sql -> 0002_auth_context.sql -> 0003_settlement.sql. CREATE TABLE/INDEX/TRIGGER и ADD COLUMN, без DROP/TRUNCATE/DELETE пользовательских данных. Не повторять файлы вручную через execute: Wrangler ведёт d1_migrations. При частичном сбое остановиться, проверить журнал применённых миграций; не удалять базу. D1 runtime должен подтвердить CHECK/RETURNING/trigger и batch rollback, включая changes() guard.

После проверок и отдельного разрешения на deployment:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
npx wrangler deploy --config wrangler.staging-leaderboard.jsonc --dry-run
npx wrangler deploy --config wrangler.staging-leaderboard.jsonc
```

Последняя команда НЕ выполнена. Записать фактические Version ID/Deployment ID/URL. До неё закрыть тестовые комнаты и предупредить QA: активные матчи при перезапуске DO могут потеряться. Если применены только миграции без deployment, старый Worker остаётся без нового binding.

## Безопасность: проверено и ограничения

Код: фиксированные Origin/RP ID, обязательный UV, настоящая SDK-проверка подписей, одноразовые challenges; HttpOnly/Secure/SameSite=Strict/Path=/ cookies; POST требует Origin, JSON и ограничение тела; CORS разрешающих заголовков нет. Сессии/recovery хранят только SHA-256, ошибки не раскрывают ключи. Gateway удаляет поддельные внутренние headers, аккаунт не берётся из JSON/ника. Reconnect требует room token и тот же аккаунт; перед start проверяется срок/отзыв сессии. Открытый ранее WebSocket после logout не закрывается автоматически; старт с отозванной сессией не рейтинговый. Уже начатый матч сохраняет первоначальную авторитетную привязку.

D1 settlement/outbox имеют UUID/hash/unique ledger и атомарный batch с revision guard. Найден и исправлен обход pair cap при обратной доставке: pair_history.played_at теперь означает серверное время settlement, а не finish receipt; обратная доставка не даёт четвёртому матчу новые очки. Подтверждено адаптерным регрессионным тестом; D1 runtime ещё не проверен.

Оставшиеся риски:
- Активный матч не восстанавливается из DO storage. Outbox сохраняет только завершённые результаты.
- Нет подключения игрового экрана Leaderboard к API и обычного login UI. Backend можно проверять через DevTools helper; это не доказательство готовности интерфейса Leaderboard.
- IP rate limit не защита от распределённых запросов/Sybil; пары ограничены, но победы/серии как статистику можно повторять даже при нулевых очках.
- Удаление одного аккаунта до delivery делает весь pending матч void: безопасно для персональных данных, но остальные игроки могут не получить результат. Политику нужно согласовать перед публичным рейтингом.
- Archived сезон допускает позднюю доставку и не immutable. Outbox permanent conflict требует диагностики; нет административного retry/fault-injection API.
- catch-all HTTP ошибка authenticationFailed маскирует также сбой базы; secret-safe, но затрудняет диагностику runtime.
- SDK/workerd/D1 совместимость и реальное сохранение ещё не доказаны. Существующий MCP npm advisory остаётся вне scope.

## Реальный QA после разрешения

1. Два разных браузерных профиля/устройства, два разных аккаунта. Две вкладки одного профиля делят cookie и не заменяют двух игроков. В каждом открыть staging и вставить scripts/leaderboard-browser-qa.js в DevTools Sources > Snippets. Скрипт проверяет точный staging origin, не включён в dist, не выводит секреты автоматически. Использовать только локальный файл проекта.
2. Выполнить await ruleshiftQa.register('TestOne') / TestTwo и завершить настоящий системный passkey prompt. Полученные recovery codes сохранить приватно; не отправлять логи/скриншоты этих кодов. Убедиться в account/me и атрибутах cookies в Application. Повтор verify/recovery challenge должен быть отвергнут.
3. await ruleshiftQa.logout(); await ruleshiftQa.login(); UUID тот же. Закрыть браузер, открыть снова, проверить me; после expiry нужен новый вход. С одного устройства попробовать cross-device passkey. Проверить recovery через ruleshiftQa.recover(code), новый passkey сохраняет UUID; повтор того же кода не работает, старые сессии отозваны.
4. Создать настоящую Online-комнату из игрового меню, подключить второй авторизованный браузер, выбрать режим хостом, ready/start. Завершить полный матч без искусственного клиента-победителя. Зафиксировать outcome/mode и время без session/room tokens.
5. После alarm доставки запросить await ruleshiftQa.ranking('overall','lifetime') и для режима. Проверить me, wins/losses/draws/games/place. Обновить страницу, вновь запустить snippet и повторить запрос; данные прежние. Прочитать публичный /api/leaderboard?mode=overall&season=lifetime через браузер. Игровой экран пока покажет «сервис не подключён»: это известный blocker, не успех UI.
6. Проверить D1 без чтения secrets:

```powershell
npx wrangler d1 execute ruleshift-2-staging-rankings --remote --config wrangler.staging-leaderboard.jsonc --command "SELECT id,mode,status,started_at,finished_at FROM matches ORDER BY finished_at DESC LIMIT 10; SELECT COUNT(*) AS guards FROM settlement_guard; SELECT match_id,COUNT(*) AS participants FROM participants GROUP BY match_id; SELECT match_id,COUNT(*) AS entries FROM settlement_ledger GROUP BY match_id;"
```

Для двух участников settled match: 2 participants, 8 ledger entries (2 игрока * overall/mode * lifetime/month), guards=0. Никакие credentials/session/recovery/challenge columns не экспортировать.
7. Проверить все четыре Online режима; затем 2–8 игроков. Выход, сетевой обрыв короче/дольше grace, reconnect тем же аккаунтом, попытка reconnect чужим аккаунтом. Несколько Rematch: новые UUID, один учёт каждого матча. После четвёртого матча пары за сутки рейтинг не меняется, статистика games увеличивается.
8. Повторная доставка, временная ошибка D1 и конкурентные GameRoom записи требуют контролируемого staging-only fault-injection теста после отдельного согласования. Нельзя подменять это reload страницы: reload не воспроизводит outbox replay. Публичного endpoint для загрузки receipt нет и добавлять его ради теста нельзя.
9. Проверить отказ protocol v7/клиентам без версии на реальном WebSocket: versionMismatch/matchReset по текущему parser; браузерный v8 продолжает работать. Результат проверять в RU/EN игровом клиенте.
10. Для рестарта Worker/DO нужен доказанный контролируемый restart/eviction в тестовом окружении. Обычный reload браузера и повторный deployment не являются доказательством конкретного DO restart. Не менять ресурсы/классы DO ради этого. После подтверждённого рестарта завершённый outbox доставляется один раз; активный матч сейчас должен сброситься без фиктивного начисления.
11. Свежий passkey login, затем await ruleshiftQa.deleteAccount(). Проверить me=401, исчезновение из API, отсутствие sessions/credentials/codes/ratings и невозможность resurrection при pending receipt. Удалять только собственные тестовые аккаунты, после согласования.

## Активный матч: безопасное решение

Краткосрочная рекомендуемая политика — interrupted/unrated, не пытаться определять победителя по браузерным данным или считать outbox восстановлением. Сохранять durable start UUID/roster; после новой инстанции DO без восстановленной симуляции атомарно отмечать этот UUID interrupted/void и уведомлять клиентов существующим matchReset. Pending completed outbox доставлять независимо. Это предложение: новый interrupt journal/API ещё не реализован. Обновления staging проводить между матчами.

Полное resume — отдельный этап: versioned checkpoint Room + deterministic RNG state + hazards/physics/cooldowns/scoring/clock + roster/account binding, replay input log или гарантированные checkpoints; восстановление времени без большого dt; повторная авторизация reconnect и ограниченное grace; tests crash между result/outbox/ack. Snapshots для renderer недостаточны. Нельзя сериализовать только позиции или реконструировать результат из клиента. Если wire messages меняются, потребуется обоснованная protocol migration; текущая подготовка сохраняет v8.

## Откат

До rollout сохранить текущий staging Version ID и привязки. На rollback закрыть QA комнаты, сохранить базу и outbox, ничего не удалять. Если выбранная версия совместима с текущими resources, команда (UUID заменить сохранённым значением):

```powershell
$stagingPreviousVersion = 'REPLACE_WITH_SAVED_STAGING_VERSION_UUID'
npx wrangler rollback $stagingPreviousVersion --config wrangler.staging-leaderboard.jsonc
```

Cloudflare может запретить rollback из-за изменений bindings/resources. Поэтому не считать команду гарантией: fallback — отдельный согласованный deployment сохранённого старого кода с тем же D1 binding и DO v1, без SQL down migrations и удаления D1. Старый код может не доставлять outbox; его сохранить для возврата совместимого кода. Версия без D1 отключит новые auth/ranking API, но не удалит базу. Откат Worker не откатывает записи D1. Для DB rollback использовать forward-fix migration; восстановление backup/Time Travel отдельное согласованное действие, поскольку откатывает данные. SQL exports с аккаунтами/ключами не помещать в репозиторий.

## Разрешения и вердикт

В этой подготовке реально выполнены: npm test 247/247; npm run typecheck (клиент/Worker/MCP); npm run build, завершён за 4.00 секунды; git diff --check; staging и staging-leaderboard dry-run, оба exit 0 (919.75 KiB / gzip 164.34 KiB); проверка синтаксиса browser QA helper. Защищённые файлы неизменны. Реальный passkey, удалённый D1, Online-матч, restart и fault injection только запланированы. Известный локальный workerd EPERM повторно не обходился.

Отдельного разрешения требуют: создание staging D1, подстановка полученного UUID и удалённые миграции, deployment только staging, контролируемый fault injection/restart, удаление тестовых аккаунтов, rollback deployment/restore. Ни одно такое действие не выполнено.

GO для ограниченного backend staging QA после разрешения ресурсов/миграций/deployment и сверки account/UUID. NO-GO для объявления Global Leaderboard готовым: настоящий матч ещё не записан в D1, UI не подключён, рестарт/повторная доставка в runtime не проверены. Полный release criterion остаётся открытым.

