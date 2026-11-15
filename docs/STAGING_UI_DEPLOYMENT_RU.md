# Staging RULESHIFT 2.0 — публикация нового UI

2026-10-09, ветка `feature/ruleshift-2-chaos-update`. Пользователь разрешил обновление только staging. Production, MCP, secrets и Cloudflare-ресурсы других окружений не изменялись. Commit/push/merge/удаление ресурсов не выполнялись.

- URL: https://ruleshift-2-staging.zamusik-play.workers.dev
- Deployment ID: `d9601087-d401-4370-ad2f-6ff327da2790`
- Version ID: `3d1266a6-345b-4948-ab72-ea95618eed99`, 100% traffic.
- Deployment created: `2026-10-09T12:28:35.610103Z`.
- Команда: `npx wrangler deploy --config wrangler.staging.jsonc`.

## Проверки до публикации

Ветка подтверждена. Изменения редизайна — UI/CSS/локализация и перечитывание parent bounds/Phaser scale при входе в матч. Игровые изменения общего diff относятся к ранее существовавшей RULESHIFT 2.0; случайных новых изменений shared engine/collision/Worker в этапе редизайна не обнаружено.

Аккаунт совпадает с предыдущим staging deployment. Конфигурация: `ruleshift-2-staging`, `routes: []`, собственный ROOMS/GameRoom без `script_name` на production, ASSETS из `./dist`. Service Bindings/D1/KV/R2 отсутствуют; staging secret list пуст. Production-конфигурация для deployment не использовалась.

`npm test` — 158/158, 0 failures (~41.5 сек); `npm run typecheck` — клиент/Worker/MCP успешно; `npm run build` — успешно, Vite ~8.84 сек; staging Wrangler dry-run — успешно. Единственное build warning — прежний Phaser chunk >500 kB. `git diff --check` — успешно.

`Start.bat` и `docs/PROJECT_REPORT_RU.md` не изменены, SHA256 совпадают с исходными. workerd runtime не запускался.

## Проверка опубликованных assets

HTML HTTP 200 и побайтно равен `dist/index.html`. Все referenced JS/CSS HTTP 200 и побайтно равны локальным assets. Для assets получен `Cache-Control: public, max-age=0, must-revalidate`.

| Asset | SHA256 |
| --- | --- |
| index-BEcKzjge.js | c48851682dfa768ac1785b88caf6e01cb6332cb020de0c818864ccaf0a5b423a |
| index-DGS_cBxC.css | d542bbbc9936891650e7b088dc2a10c2d3819ec5bb5380f9e427314cbbc84294 |
| phaser-DFK5Ua9d.js | f9025c1a29bc3ae097dd886ce07717b297466da1ce8f032c8294252ce6cf5cdb |

## Реальный remote QA

В опубликованном staging через Codex In-app Browser:

- Новый главный экран и все девять карточек видны.
- Offline Classic/Survival/Blitz/Chaos/Daily: каждый запущен через соответствующую карточку (Survival/Daily через intro), арена/пауза доступны; End run показывает результаты, возврат в меню работает. Это короткие smoke runs, не полные 90-секундные или длительные матчи.
- Два настоящих браузера подключились к одной комнате Classic, синхронизировали ready, стартовали, показывали общий Crossfire/HUD, получили победу/поражение после завершения матча и вернулись в лобби после Rematch со сброшенной готовностью.
- Last One Standing/Blitz/Chaos: комнаты созданы через соответствующие UI-карточки. Второй реальный Node WebSocket-клиент подтвердил два участника и правильный `mode` в серверном snapshot каждого лобби. Полные матчи этих трёх режимов не запускались.
- Отдельный real HTTP/WebSocket smoke с двумя Node-клиентами: POST room, join, цвета, host authority, ready/start, authoritative movement, reconnect с тем же ID, leave/winner и Rematch — PASS. Temporary script был ограничен точным staging origin и удалён; secrets/tokens не печатались.
- Профиль: четыре вкладки, рекорды, 17 достижений, Daily history, RU/EN. После браузерного Classic серверный результат отображается в Online-статистике.
- Leaderboard: честное состояние «сервис не подключён», mode/archive filters, disabled поиск своей позиции, RU/EN. Реального глобального backend по-прежнему нет.
- Responsive: 320×740, 375×812, 390×844, 768×1024, 1024×768, 1920×1080 и 740×320. Меню (7), четыре вкладки профиля (28), Leaderboard (7): все 42 проверки `scrollWidth <= clientWidth` прошли. Все девять карточек меню присутствуют на каждом размере.
- В двух основных браузерных клиентах console errors/warnings не обнаружены. Автоматизация один раз не подтвердила действие Join; после фиксации актуального DOM и повторного нажатия подключение прошло. Попытка нажать Leave в игре застала уже завершившийся матч; фактические Results/Rematch проверены. Эти события не выданы за обнаруженные ошибки приложения.

Тестовые участники завершили соединения/вышли из лобби; Workers и Durable Objects не удалялись. Viewport override сброшен.

## Оставшееся ручное QA

Физические Android/iPhone, настоящий multitouch joystick+Dash, safe areas и Safari/audio; 2–8 игроков на разных сетях; полные Online Blitz/Chaos/Last One Standing, несколько последовательных Rematch; полные Daily/Blitz; длительные Survival/Chaos; FPS/CPU/memory на слабых устройствах. Эти проверки не заменяются выполненным smoke и resize в desktop-браузере.

UI staging обновлён успешно. Это не разрешение на production-релиз; server accounts/ranking требуют отдельного согласования и реализации.
