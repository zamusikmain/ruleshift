# RULESHIFT 2.1: staging deployment и настоящий QA — 2026-10-10

Ветка `feature/ruleshift-2-chaos-update`, protocol v8. Разрешены только staging D1, её миграции, deployment и QA. Production, другие Workers, commit/push/merge и защищённые файлы не изменялись.

## Окружение

- URL: https://ruleshift-2-staging.zamusik-play.workers.dev
- Deployment ID: `89718157-97fc-4d2d-8abf-49c10d6114b0`.
- Version ID: `7223e1be-3c30-4ab4-8263-f8008cf5452c`, 100% трафика.
- D1: `ruleshift-2-staging-rankings`, UUID `2e06c6ff-41ee-42fc-9934-1d1868631956`.
- Конфигурация: `wrangler.staging-leaderboard.jsonc`; binding `RANKINGS_DB`; собственный `ROOMS` → `GameRoom`; `ASSETS` → dist.
- AUTH_ORIGIN: `https://ruleshift-2-staging.zamusik-play.workers.dev`.
- AUTH_RP_ID: `ruleshift-2-staging.zamusik-play.workers.dev`.

До создания список D1 аккаунта был пуст. Production database IDs, script_name, bindings и secrets не использованы. В настоящей staging D1 успешно применены `0001_accounts_ratings.sql`, `0002_auth_context.sql`, `0003_settlement.sql`. Проверены схема, ограничения, индексы, triggers и журнал миграций; foreign_key_check пуст.

Первая попытка deployment: сетевой fetch failed на начальном GET Cloudflare API, до upload. Проверка deployments подтвердила сохранение прежней версии. Один повтор той же разрешённой команды успешно опубликовал staging; изменения кода не потребовались.

## Проверки сборки

- npm test: 256/256, 0 failures, 45,995 с.
- TypeScript клиента/Worker/MCP: успешно.
- npm run build: успешно, 6,11 с.
- Staging leaderboard Wrangler dry-run с действительным D1 UUID: успешно.
- git diff --check: успешно.
- Хеши Start.bat и docs/PROJECT_REPORT_RU.md сохранились.

Главная страница и JS/CSS: HTTP 200, assets побайтно совпадают с локальным dist. Cache-Control: public, max-age=0, must-revalidate.

| Asset | SHA-256 |
|---|---|
| index-DB8WlFBI.js | 5ae3d802c7309712f355f1fcc7c50b05bc67cee821f486bf1a30ab90b36ef2ce |
| phaser-DFK5Ua9d.js | f9025c1a29bc3ae097dd886ce07717b297466da1ce8f032c8294252ce6cf5cdb |
| index-BcWJENWI.css | 9de1865b967809c0806b4f02db215cd391d04f45addeeb58ec2876cb150e27ac |

App bundle 152,24 kB / gzip 52,85; Phaser 1208,06 kB / gzip 332,17. Предупреждение Vite о крупном Phaser chunk остаётся. Worker startup 3 ms по Wrangler — не показатель FPS. Ограниченный скан конфигурации/dist не обнаружил private key headers или явно присвоенных MCP/Cloudflare secret значений; это не полноценный secret audit.

## Реальные Cloudflare и браузерные проверки

До матчей API возвращал настоящий пустой рейтинг и сезон 2026-10. Без сессии account/me — 401; POST logout с чужим Origin — 403. Искусственные результаты не создавались.

Два разных аккаунта Staging QA и Zamirzhan авторизованы через passkeys в независимых браузерах. Системные подтверждения выполнял пользователь. Повторный вход первого аккаунта после logout подтверждён; reload сохранял сессию.

В одной комнате проведены два обычных Classic-матча с завершением от игровых hazards, без клиентской подстановки победы или SQL начисления:

| Матч | Победитель | Время | UUID |
|---|---|---|---|
| Первый | Staging QA | 00:22 | 741b9173-7227-45de-b61e-cac13426535e |
| Rematch | Zamirzhan | 00:14 | 8864d574-b274-4e94-a0d9-812a44221df1 |

D1 содержит 2 settled-матча. У каждого участника ровно 2 игры, 1 победа, 1 поражение. 8 rating rows: два участника × overall/Classic × lifetime/2026-10. Ledger содержит 16 начислений, duplicate groups=0. После первого матча: 1006/994; после второго: 1002,9/997,1 (UI округляет). Общий рейтинг, места, win rate, streak и месячный Classic показаны из API. Reload сохранил первый результат; Rematch обновил таблицу.

Это доказательство нормального пути. Принудительные D1 outage, повторная доставка outbox и конкурентная дедупликация проверялись только локальными тестами, не fault injection на Cloudflare.

Logout в отдельной вкладке прекратил авторизованный WebSocket другого окна; клиент получил matchReset. Дополнительный настоящий сетевой smoke-test с двумя гостевыми клиентами подтвердил создание/подключение, readiness, серверное движение, reconnect, победителя после выхода и Rematch.

Настоящие сетевые smoke-tests всех четырёх Online-режимов с 8 гостевыми WebSocket-соединениями подтвердили host-only выбор, синхронизацию, старт, результаты после выходов и Rematch. Protocol v7 получил versionMismatch. Это программные реальные подключения, не 8 людей на разных устройствах и не полные рейтинговые матчи каждого режима.

Запущены все пять Offline-режимов, проверены короткие забеги/результаты, пауза Classic, поражения Chaos и Blitz. Blitz показал 01:30. Survival показал отдельные время/очки/events и рекорды; Daily — UTC-дату, цель и отдельный результат неудачной попытки. Полные 90-секундные Daily/Blitz не пройдены. Наблюдалось предупреждение Bullet Storm; все hazards/combos/Overdrive вручную не покрыты.

Профиль сохранился после reload. Floating/Large (168 px) сохранились после reload; затем возвращены Fixed/Medium. Есть sensitivity, dead zone, slider и preview. Мобильные кнопки при клавиатурном управлении не отображались. Полноценный направленный Dash и остальные способности вручную не подтверждены. RU/EN меню/рейтинга просмотрены. На viewport 320×640 scrollWidth=305, горизонтального переполнения страницы нет. Ошибок в просмотренных console logs не было. Физический телефон и FPS не проверены.

## Ограничения

- Branding остаётся v2.0, хотя dist новый.
- Уход с экрана во время регистрации может скрыть последующий одноразовый показ recovery codes: закрытый view не выполняет render. Дождаться завершения и сохранить коды приватно. Код в ходе rollout не изменялся.
- Logout другого окна показывает общее сообщение «Комната перезапущена», а не причину отзыва сессии.
- Не проверены physical multitouch, touch cancellation, joystick+Dash, Android/iPhone/tablet, rotation/safe areas, FPS/CPU/memory, полный визуальный цикл всех hazards/Overdrive.
- Не проверены удалённо принудительный restart Worker/DO, interrupted/void, D1 outage/outbox retry, удаление аккаунта при pending outbox, реальная ничья, rated reconnect во время матча и смена месяца.
- Настоящее восстановление Zamirzhan с новым passkey выполнено при системном подтверждении пользователя; аккаунт и рейтинг сохранились. Набор recovery codes заменён. Повторное использование строго одного и того же кода на staging достоверно не подтверждено: показанный набор менялся в ходе асинхронного обновления UI. Одноразовость покрыта локальными тестами, не считать эту browser попытку доказательством.
- Сообщение пользователя «восстановилось без кода» проверено прямыми запросами к опубликованному endpoint: missing/empty/whitespace code → HTTP 400 authenticationFailed, без выдачи session cookie. Пустое поле после logout имело длину 0. Серверный auth bypass не воспроизведён; точная исходная последовательность действий не установлена.
- UI сохраняет панель ранее выданных recovery codes после logout; ошибки auth могут сменяться статусом фонового обновления таблицы. Требуется отдельное исправление жизненного цикла auth UI. В этой работе код не менялся.
- Браузерный инструмент при неоднозначном выборе поля неожиданно включил recovery code в диагностический ответ. Код не повторялся и не сохранялся в файлах. Соответствующий набор заменён через штатное восстановление; новые коды в диагностику не выводились.

## Откат

Сохранена прежняя Version ID `3d1266a6-345b-4948-ab72-ea95618eed99`. При необходимости откатывать только код, сохраняя D1/миграции; старый код не предоставляет новый Leaderboard backend. Откат не выполнялся.

```powershell
npx wrangler rollback 3d1266a6-345b-4948-ab72-ea95618eed99 --config wrangler.staging-leaderboard.jsonc
```

Главный сценарий passkeys → два авторизованных клиента → матч → настоящая D1 → Leaderboard → reload/Rematch подтверждён. GO для продолжения ограниченного staging QA. Это не GO для публичного production-релиза; перечисленные ограничения требуют завершения проверки.
