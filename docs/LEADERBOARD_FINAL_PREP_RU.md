# Leaderboard — финальная локальная подготовка staging

Ветка feature/ruleshift-2-chaos-update, protocol v8. Cloudflare D1 и другие удалённые ресурсы не созданы; deployment/commit/push/merge не выполнялись. Состояние опубликованных production/staging не изменено.

## Что подключено

Существующая кнопка Leaderboard открывает src/leaderboardView.ts. src/leaderboardApi.ts выполняет same-origin запросы с cookies и no-store. Экран показывает реальные API rows: top-100, общий/по режиму рейтинг, своё место (также вне top-100), очки, wins/losses/draws/winPercent/streak, текущий UTC-сезон и архив. Loading/empty/unauthorized/unavailable/network errors локализованы. Ответы устаревшего запроса не заменяют выбранный фильтр. Перезагрузка страницы вновь читает базу; локальный XP/профиль в рейтинг не импортируются.

После авторитетного результата Online публикуется сигнал обновления. Открытый экран дополнительно читает таблицу каждые 10 секунд, чтобы увидеть результат после задержки outbox. Poll не повторяет profile/seasons запросы, отключается при выходе и не мешает вводу recovery code/фокусу. Изменение режима/сезона и Refresh читают данные заново. Общего клиентского кэша рейтинга нет.

Регистрация/login/recovery используют navigator.credentials.create/get с binary/base64url преобразованием и существующей серверной SDK-проверкой. Recovery codes показаны один раз, только в памяти экрана; после подтверждения/выхода очищаются, в localStorage не записываются. Есть logout и подтверждение удаления аккаунта; удаление требует свежего passkey login на сервере. Все новые тексты RU/EN. Таблица имеет горизонтальный scroll внутри контейнера.

## Прерванные матчи и доставка

При запуске новой инстанции GameRoom проверяется ranked-start. Если нет durable completed marker/outbox, сохраняется interrupted:<match UUID> со статусом interrupted/reason restart. Никакой receipt для начисления не создаётся. Старый Room не реконструируется из браузерных данных; next connect получает существующий matchReset. Wire format не менялся.

Completed marker и outbox записываются одним storage.put(object). Повтор capture после ошибки setAlarm не пересоздаёт receipt/finishedAt и не меняет hash. Completed marker остаётся после delivery: crash между доставкой и удалением ranked-start не делает завершённый матч interrupted. Повторная доставка дедуплицируется в D1. Новый Rematch/start создаёт новый UUID. Полного resume активной симуляции нет; interrupted/completed markers пока не имеют retention cleanup.

## Исправления безопасности

- Logout/recovery/delete публикуют клиентский сигнал отзыва и закрывают текущий Online socket без autoreconnect. Сервер раз в секунду одним SQL-запросом перепроверяет authenticated sessions комнаты: revoked/expired/deleted закрываются с matchReset, даже после logout из другого устройства. При недоступности D1 соединения fail closed. Нагрузку/latency этого запроса необходимо измерить в runtime.
- AuthFailure отделён от ошибок D1/конфигурации: неверная WebAuthn-аутентификация -> безопасный authenticationFailed/400; база -> serviceUnavailable/503, без внутреннего текста/секретов. JSON/filter validation -> invalidMessage/400.
- Deleted участник pending outbox делает матч void атомарно, без rating/participants/ledger. Retry не дублирует void и не восстанавливает удалённый аккаунт. Политика остаётся прежней: остальные участники такого матча тоже не получают rating; перед публичным релизом нужно решить, подходит ли она.
- Pair cap по времени settlement, атомарная revision/dedup, проверки Origin/RP ID/UV и cookie flags сохранены.

## Реально выполненный QA

Финальные проверки: npm test 256/256 (0 failures); npm run typecheck — успешно (клиент/Worker/MCP); npm run build — завершён за 9.04 секунды, 50 modules; git diff --check — exit 0. wrangler.staging.jsonc и wrangler.staging-leaderboard.jsonc dry-run — оба exit 0, Worker 922.16 KiB / gzip 164.88 KiB. Клиентский JS 152.24 kB / gzip 52.85 kB. Start.bat и docs/PROJECT_REPORT_RU.md имеют прежние SHA-256. Локальный Vite после QA остановлен.

Автотесты: серверный SDK и криптографические подписи; SQLite D1 adapter; mocked DO/WebSocket; UI server payload fixtures. Добавлены фильтры, своё место/статистика, empty/unavailable/loading, RU/EN, native credential wire conversion, logout session invalidation, restart journal/matchReset, deleted pending outbox, стабильность receipt после alarm failure. Это не настоящий сетевой тест и не D1 integration.

Браузер: локальный Vite, настоящий экран, открытие/назад, EN/RU, режим Chaos/архив, состояние ошибки без backend, viewport 320x640. Document scrollWidth 305 при viewport 320: горизонтального переполнения экрана нет; кнопка recovery укладывается в ширину. Console error entries: 0 на момент проверки. Реальные строки базы в браузере не показаны, поскольку runtime недоступен; физический passkey не проверялся. Браузерная проверка таблицы с полным top-100 и физических устройств остаётся для staging.

## Что требует настоящего Cloudflare QA

Использовать wrangler.staging-leaderboard.jsonc и план STAGING_LEADERBOARD_QA_RU.md после отдельного разрешения: создать отдельную staging D1, подставить её UUID, применить 0001–0003, staging deployment. Теперь passkeys и рейтинг доступны через игровой UI; DevTools helper необязателен. Проверить два разных аккаунта -> полный матч -> D1 -> UI -> reload, recovery/revocation, 2–8 игроков, Rematch/reconnect, DO restart, pending replay/temporary D1 failure/concurrency и удаление тестового аккаунта. Не считать reload браузера доказательством DO restart.

GO для создания изолированной staging D1 и дальнейшего контролируемого QA после разрешения. NO-GO для объявления Global Leaderboard полностью готовым: Workers/D1 runtime, настоящий матч и браузерный passkey ещё не подтверждены. Локальный workerd EPERM повторно не обходился. Существующий Phaser bundle warning и отдельный MCP advisory остаются.
