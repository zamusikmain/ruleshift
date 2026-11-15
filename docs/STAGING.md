# RULESHIFT 2.0 — изолированный staging

Статус: **первый staging deployment опубликован по разрешению пользователя 2026-10-09**. Ветка `feature/ruleshift-2-chaos-update`; без commit/push/merge.

Фактический адрес, подтверждённый Wrangler, HTTP и браузером:

`https://ruleshift-2-staging.zamusik-play.workers.dev`

Перед первым deployment API Cloudflare вернул `This Worker does not exist on your account`, code 10007: существующий Worker не перезаписывался. Проверен аккаунт `3539eaa9ecd18211cc2fb996ea0c39cf`. Перед последующими публикациями всегда проверяйте аккаунт и target Worker; новый deployment требует отдельного разрешения.

- Deployment ID: `afa8865d-006d-44ca-b85e-87478c116f39` (Cloudflare deployments list JSON).
- Version ID: `e5151660-7b5f-4269-9893-dfafd77dfce1`, 100% трафика, создана `2026-10-09T10:46:04.283Z`.
- Staging ROOMS namespace ID: `754da93168214f1288aabe980c60f567`; migration `v1`.
- Remote version metadata содержит только `ROOMS: GameRoom` и `ASSETS`; remote `wrangler secret list` вернул `[]`.

Повторно прошли 153/153 теста (27.53 сек), typecheck, build (Vite 7.77 сек), staging dry-run. Настоящий сетевой smoke с двумя Node WebSocket клиентами подтвердил HTTP create, join, цвета, ready/start, запрет start гостю, движение по серверным snapshots, краткий socket reconnect с тем же player ID, winner после добровольного выхода и Rematch в lobby. Отдельный real handshake v5 получил `versionMismatch`/1008 без welcome; чужой Origin отклонён HTTP 403. Это один короткий Classic сценарий, не полная матрица режимов/устройств.

HTML, CSS, код игры и Phaser вернули HTTP 200 с ожидаемыми Content-Type. В браузере IAB создан тестовый профиль, запущен Offline Classic, показаны результаты естественного поражения; через UI создана Online-комната, lobby показал хоста 1/8, выполнен штатный выход. Ошибок консоли не обнаружено. Полный mobile/Online QA остаётся pending. Временные сетевые скрипты находятся только в игнорируемой `.wrangler/`, localhost-only smoke-test не изменён.

Проверка подозрения на старую версию: [asset audit](STAGING_ASSET_AUDIT.md). Новые механики уже опубликованы; обнаружены устаревшая маркировка версии и обрезание кнопок выбора режима. Исправления пока только локальные, повторная публикация не выполнялась.

## Разделение ресурсов

| Ресурс | Production | Staging |
|---|---|---|
| Конфигурация | `wrangler.jsonc` | `wrangler.staging.jsonc` |
| Worker | `ruleshift` | `ruleshift-2-staging` |
| Статические файлы | production deployment | отдельный upload `dist` |
| `ROOMS` | namespace `ruleshift` / `GameRoom` | новый namespace `ruleshift-2-staging` / `GameRoom` |
| SQLite/DO storage | комнаты production | отдельные данные staging |
| Браузерные сохранения | origin production | origin staging |
| MCP | `ruleshift-mcp` → `ruleshift#GameInspection` | не подключён и не публикуется |

Отдельная самостоятельная конфигурация не наследует production bindings. У `ROOMS` нет `script_name`/`environment`, поэтому класс принадлежит публикуемому staging Worker. Полная идентичность комнаты включает namespace: одинаковый шестизначный код в двух средах не обозначает один объект. Session IDs/tokens генерируются в соответствующей комнате; перенос токенов между средами не предусмотрен.

KV, D1, R2 и внешние services не используются. Дополнительных production secrets не требуется. Никакой `MCP_KEYS` staging-игре не нужен. Авторизация Wrangler хранится вне конфигурации; не копируйте API token в файлы или клиентские `VITE_*` переменные.

Клиент использует `/api/rooms` относительно текущего origin, WebSocket строится из `location.href` и HTTPS → WSS. Worker пропускает `/api/*` перед статическими assets и проверяет Origin. Сборка клиента и Worker берётся из одного checkout; оба импортируют общий `PROTOCOL_VERSION = 6`. Клиент v5 получает `versionMismatch`, close 1008 и существующее RU/EN сообщение о перезагрузке. Отсутствующая версия обрабатывается существующим `matchReset`. Это проверено unit tests; реальный handshake необходимо проверить после публикации.

## Перед первой публикацией

1. Оставьте основной Cloudflare pipeline без изменений. По ранее предоставленным настройкам он публикует `main` командой `npx wrangler deploy` в `ruleshift`; актуальные настройки панели в этом этапе не проверялись. Не подключайте staging к этому pipeline и не публикуйте feature-ветку его обычной командой.
2. Используйте существующие Node/npm/Wrangler. `--no-install` исключает загрузку дополнительного пакета. Если авторизация уже есть, повторный login не нужен. Если её нет: `npx --no-install wrangler login`, вход через Cloudflare. При нескольких аккаунтах выберите правильный; не публикуйте до проверки аккаунта/доступного имени.
3. Убедитесь, что в текущей оболочке нет неожиданного `CLOUDFLARE_ENV`, а в проекте нет `.env`/`.dev.vars` с production-секретами. Не печатайте значения переменных. Не запускайте deploy с `--env`, `--name ruleshift` или другим config.
4. Все тестировщики должны получить только staging URL. Production остаётся отдельной контрольной версией; тестовые комнаты в нём не создавайте.

Команды PowerShell из корня проекта; после каждой проверки остановитесь, если код возврата не равен 0:

```powershell
git branch --show-current
npm test
npm run typecheck
npm run build
git diff --check
npx --no-install wrangler deploy --config wrangler.staging.jsonc --dry-run --outdir .wrangler/staging-dry-run
```

Должны быть ветка `feature/ruleshift-2-chaos-update`, protocol v6, имя `ruleshift-2-staging` и только bindings `ROOMS: GameRoom`, `ASSETS`. Dry-run не доказывает права аккаунта, provisioning DO, WebSocket или отсутствие конфликтующего существующего имени.

**Следующая команда публикует новую staging версию. Первый deployment уже выполнен; повторять только после отдельного разрешения:**

```powershell
npx --no-install wrangler deploy --config wrangler.staging.jsonc
```

Сохраните Version ID и фактический URL из вывода. В панели Worker убедитесь, что `ROOMS` принадлежит именно `ruleshift-2-staging`, namespace ID отличается от production; нет bindings на `ruleshift`, `ruleshift-mcp`, KV/D1/R2 или секретов игры. Затем выполните [план реального QA](STAGING_QA.md).

Проверка статических файлов после публикации:

```powershell
Invoke-WebRequest -Uri 'https://ruleshift-2-staging.zamusik-play.workers.dev/' -Method Get | Select-Object StatusCode
```

Если Wrangler сообщил другой URL, используйте его после проверки имени Worker и аккаунта. Не переадресовывайте тестовые запросы на production. Существующий `npm run test:online` допускает только localhost и не должен обходиться для remote проверки.

## Откат без удаления данных

До каждого следующего staging deploy сохраните предыдущий Version ID. Список:

```powershell
npx --no-install wrangler versions list --config wrangler.staging.jsonc
```

Откат только к известной рабочей **staging** версии, заменив placeholder её ID:

```powershell
npx --no-install wrangler rollback <STAGING_VERSION_ID> --config wrangler.staging.jsonc --message 'Staging QA rollback'
```

Не вводите угловые скобки буквально. Не используйте production Version ID. Откат не восстанавливает данные DO или localStorage; после него перезагрузите страницы, создайте новые комнаты и повторите smoke QA. Изменение lifecycle классов DO между версиями может запретить rollback. На первом deployment предыдущей игровой версии staging ещё нет: при критической ошибке отключите workers.dev у `ruleshift-2-staging` через панель Cloudflare; это остановка доступа, не rollback и не удаление данных.

## Окончательное удаление тестового окружения

Это отдельная необратимая операция, **не команда отката**. Завершите тесты и предупредите участников о потере комнат. Проверьте, что никто не привязал другой Worker к staging namespace. Никогда не используйте `--force` для обхода найденной зависимости.

Подготовлены `wrangler.staging-retire.jsonc` и `worker/staging-retired.ts`: тот же staging Worker, без assets и bindings, без экспорта `GameRoom`, migration `staging-retire-v2` удаляет только его класс и данные. Сначала локальная проверка, затем только после решения об окончательном удалении:

```powershell
npx --no-install wrangler deploy --config wrangler.staging-retire.jsonc --dry-run --outdir .wrangler/staging-retire-dry-run
# НЕОБРАТИМО: удаляет staging Durable Objects и их storage.
npx --no-install wrangler deploy --config wrangler.staging-retire.jsonc
# После успешной migration удаляет оставшийся staging Worker.
npx --no-install wrangler delete ruleshift-2-staging --config wrangler.staging-retire.jsonc
```

Если migration/deletion отклонена, остановитесь и выясните зависимости, не переходите к production config. Проверьте отсутствие staging Worker/namespace в панели. Браузерный localStorage удаляется отдельно в настройках сайта **только staging origin**. После teardown не публикуйте старую staging-конфигурацию с migration v1: для нового цикла используйте новое имя Worker и новую проверенную историю migrations.

## Ограничения и безопасность

- Публичный workers.dev URL доступен любому знающему адрес. В нём только тестовые профили/комнаты; закрытый доступ Cloudflare Access в этом этапе не настроен.
- Изоляция данных не изолирует лимиты, стоимость и разрешения аккаунта. Не проводите неконтролируемый нагрузочный тест.
- Production/MCP конфигурации и игровой код не менялись на этом этапе. Не добавляйте staging routes на production-домен.
- Секреты не добавлялись. Локальная проверка подозрительных credential patterns ограничена доступными файлами; Cloudflare runtime logs и реальные production Secret values здесь не читались. В багрепорты не включать Authorization, welcome token, cookies, DevTools Storage или полный WebSocket payload с токеном.
- Локальные профили отличаются по origin и остаются локальными; никаких глобальных наград/рейтинга staging не создаёт.
- Известный `workerd.exe EPERM` не воспроизводился повторным запуском local runtime. Dry-run — упаковка, а не работа Cloudflare WebSocket/DO.

## Результаты локальной подготовки

- `npm test`: 153/153, ошибок и пропусков нет, 18.60 секунды. Добавлены три проверки staging config, teardown и общего protocol/same-origin; существующий Worker test проверяет отказ v5.
- `npm run typecheck`: клиент, игровой Worker (включая teardown entry point), MCP Worker — успешно.
- `npm run build`: успешно, Vite завершил сборку за 5.20 секунды; предупреждение размера Phaser остаётся.
- Wrangler 4.141.0 staging dry-run: успешно, Worker 83.22 KiB / gzip 20.63 KiB, найдено 5 статических файлов, только `ROOMS` и `ASSETS`.
- Teardown dry-run: успешно, 0.47 KiB / gzip 0.29 KiB, bindings отсутствуют. Миграции в Cloudflare не применялись.
- `git diff --check`: успешно. Start.bat и docs/PROJECT_REPORT_RU.md сохранили исходные SHA-256.
- Проверено 62 доступных исходных/конфигурационных/клиентских/локальных log файла на private-key/GitHub/API-key/длинные Bearer credential patterns: совпадений 0; `.env*`/`.dev.vars*` файлов нет. Это ограниченная статическая проверка, не доказательство отсутствия любого возможного opaque token и не аудит удалённых Cloudflare logs.

Официальная документация: [изоляция DO](https://developers.cloudflare.com/durable-objects/reference/environments/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/), [rollback и его ограничения](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [конфигурация migrations](https://developers.cloudflare.com/workers/wrangler/configuration/).
