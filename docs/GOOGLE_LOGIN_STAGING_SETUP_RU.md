# Google Login для RULESHIFT staging: инструкция владельцу

Подготовлено 2026-10-10 для feature/ruleshift-2-chaos-update. Только локальная проверка и документация: Google Cloud ресурсы, secrets, удалённые миграции и deployment не выполнялись.

## Проверенные параметры кода

worker/simpleAuth.ts строит redirect_uri из AUTH_ORIGIN + /api/auth/google/callback. Такой же URI используется при обмене authorization code на токены. worker/accountApi.ts обслуживает GET этого callback; /api/* направляется в Worker через run_worker_first.

| Поле | Значение |
|---|---|
| Тип OAuth client | Web application |
| Имя client (предлагаемое) | RULESHIFT Staging Google Login |
| Authorized redirect URI (обязательно, ровно это значение) | https://ruleshift-2-staging.zamusik-play.workers.dev/api/auth/google/callback |
| Authorized JavaScript origin (если заполнять) | https://ruleshift-2-staging.zamusik-play.workers.dev |
| AUTH_ORIGIN (оставить существующий) | https://ruleshift-2-staging.zamusik-play.workers.dev |
| AUTH_RP_ID (оставить существующий) | ruleshift-2-staging.zamusik-play.workers.dev |
| Scope реально запрашиваемый кодом | openid |

Authorized JavaScript origins не требуется для используемого server-side redirect flow: приложение не загружает Google GIS JavaScript SDK и не выполняет браузерный обмен токенов. Это поле можно оставить пустым. Для однозначной настройки клиента можно указать единственный origin выше; он не заменяет обязательный redirect URI. Origin — без пути и завершающего слеша. Redirect URI — с точным путём, без завершающего слеша, query и #fragment.

Не добавлять production URL, localhost/Vite ports, /auth/google/callback, Firebase callback или MCP URL. Эти адреса не являются callback текущего staging кода.

## Google Cloud: что нажать

1. Открыть https://console.cloud.google.com/auth/overview . Выбрать проект в верхней панели. Для изоляции рекомендуется отдельный Google Cloud проект RULESHIFT Staging; если используется существующий проект, создать отдельный staging OAuth client и не редактировать production client.
2. Если Google Auth Platform ещё не настроен, нажать Get started. В Branding указать App name RULESHIFT Staging, свой User support email и контактный email владельца. В Audience выбрать External для обычных Gmail/разных организаций. Internal подходит только для разрешённых пользователей одной Workspace-организации. Завершить мастер после самостоятельного прочтения условий Google.
3. В Audience оставить Publishing status Testing, не нажимать Publish app. В Test users → Add users добавить Google-адреса владельца и второго QA-игрока. В текущем минимальном openid-only flow Google предусматривает исключение из ограничения списка test users: этот список НЕ является надёжным whitelist доступа к staging. Не считать Testing защитой опубликованной игры.
4. В Data Access не добавлять Gmail, Drive, Calendar или иные scopes: код запрашивает только openid. Для этого входа не нужны Firebase Auth, Service Account, API key или включение Gmail/Drive API.
5. В Clients → Create client выбрать Application type Web application; имя RULESHIFT Staging Google Login.
6. В Authorized JavaScript origins можно указать единственный staging origin из таблицы (для текущего flow необязательно). В Authorized redirect URIs → Add URI вставить точный callback из таблицы. Нажать Create.
7. Сохранить полученные Client ID и Client Secret от ЭТОГО ОДНОГО клиента в менеджере паролей. Google показывает полный Client Secret при создании; позднее он может быть недоступен для повторного просмотра. Не присылать secret, JSON-файл credentials, authorization code или cookies в чат и не хранить их в папке проекта.

Authorized domains в Branding — отдельное поле, не Authorized JavaScript origins. Не указывать workers.dev как принадлежащий вам домен. Не придумывать homepage/privacy/terms или заявлять владение чужим доменом. Если консоль требует подтверждение домена и отклоняет workers.dev-hosted URL, сохранить точный текст ошибки без credentials: потребуется отдельное согласование собственного домена и обновление AUTH_ORIGIN/redirect. Нельзя самостоятельно менять AUTH_RP_ID: это затронет существующие passkeys. Для текущего URL принятие Google Console ещё не проверялось.

## Какие значения нужны Worker

| Binding | Откуда | Хранение |
|---|---|---|
| GOOGLE_CLIENT_ID | Client ID созданного Web application, обычно заканчивается на .apps.googleusercontent.com | Для этой инструкции — Cloudflare Secret (сам ID не конфиденциален) |
| GOOGLE_CLIENT_SECRET | Client Secret того же Web application | Только Cloudflare Secret |

Оба имени уже поддерживает код. Для Google не требуются RESEND_API_KEY, EMAIL_FROM и AUTH_CODE_SECRET. Email останется недоступным, пока отдельно не настроен Resend.

Сначала сохранить credentials приватно. Вводить их в Cloudflare только после разрешения на изменение staging. Не ставить реальные значения в wrangler vars, VITE_* или клиентский bundle; не передавать secret аргументом команды или через echo.

## Передача credentials: только после отдельного разрешения

Обычный wrangler secret put создаёт и сразу развёртывает новую версию Worker. Cloudflare Dashboard → Variables and Secrets → Deploy тоже меняет опубликованное окружение. Это не read-only подготовка.

Для согласованного rollout с публикацией secret values вводятся отдельно в скрытый интерактивный запрос:

```powershell
Set-Location 'C:\Users\zamirzhan.janbakiyev\Projects\ruleshift'
npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.staging-leaderboard.jsonc
npx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.staging-leaderboard.jsonc
```

Перед подтверждением убедиться, что целевой Worker ruleshift-2-staging. Не использовать wrangler.jsonc, wrangler.staging.jsonc, --env production или Worker ruleshift/ruleshift-mcp. Config wrangler.staging.jsonc не содержит D1/auth bindings, хотя его Worker name совпадает со staging-leaderboard, поэтому для реального rollout использовать только staging-leaderboard конфигурацию.

Если позднее будет отдельно разрешена загрузка secrets БЕЗ переключения трафика, существуют команды:

```powershell
npx wrangler versions secret put GOOGLE_CLIENT_ID --config wrangler.staging-leaderboard.jsonc
npx wrangler versions secret put GOOGLE_CLIENT_SECRET --config wrangler.staging-leaderboard.jsonc
```

Они создают удалённые непубликованные версии и также требуют разрешения. Сами по себе они не публикуют новый локальный OAuth-код. Не считать такой шаг работающим Google Login. Перед активацией проверить, что выбранная версия содержит оба секрета, актуальный код и все D1/DO bindings. В текущей задаче ни один вариант не выполнен.

## D1 и порядок будущего rollout

Staging Worker: ruleshift-2-staging. Staging база: ruleshift-2-staging-rankings; UUID 2e06c6ff-41ee-42fc-9934-1d1868631956; binding RANKINGS_DB. Использовать существующую базу; новую не создавать.

По предыдущему deployment report применены 0001_accounts_ratings.sql, 0002_auth_context.sql и 0003_settlement.sql. Удалённый журнал в этой задаче повторно не запрашивался. Для Simple Auth требуется 0004_simple_auth.sql. Она добавляет только auth_identities, login_flows, account_nickname_choices и индексы. DROP, DELETE, пересоздания accounts/credentials/ratings/matches и изменения старых UUID в ней нет.

В будущем сначала проверить pending migrations и сохранить точку восстановления/backup, затем применять только ожидаемую миграцию 0004. Если Wrangler показывает другие pending migrations, остановиться и сверить состояние, не применять вслепую.

Подготовленные команды, сейчас НЕ выполнены:

```powershell
npx wrangler d1 migrations list ruleshift-2-staging-rankings --remote --config wrangler.staging-leaderboard.jsonc
npx wrangler d1 export ruleshift-2-staging-rankings --remote --config wrangler.staging-leaderboard.jsonc --output staging-before-simple-auth.sql.local
npx wrangler d1 migrations apply ruleshift-2-staging-rankings --remote --config wrangler.staging-leaderboard.jsonc
```

Backup содержит персональные и авторизационные данные; сохранить приватно вне публичных материалов. Суффикс .local исключён из Git. Export и удалённая миграция в этой задаче не выполнялись.

После миграции — настройка staging credentials и deployment актуальной локальной сборки, только после отдельного разрешения. Одна установка secrets не добавит OAuth endpoints в прежний опубликованный код.

```powershell
npm run build
npx wrangler deploy --config wrangler.staging-leaderboard.jsonc --dry-run
npx wrangler deploy --config wrangler.staging-leaderboard.jsonc
```

Последняя команда — deployment; сейчас не запускалась. Для rollback вернуть предыдущую согласованную версию Worker, оставив добавленные таблицы. Не удалять accounts, ratings или новые identities, не откатывать D1 с потерей новых данных. Удаление secrets тоже может запускать deployment, поэтому это не безопасный автоматический rollback.

## Сохранность пользователей

Passkeys остаются привязаны к прежним UUID и прежнему AUTH_RP_ID. Рейтинг и история связаны с UUID, не ником, email или Google display name. Миграция 0004 не меняет их.

Чтобы добавить Google к существующему Passkey-аккаунту: сначала войти через прежний passkey; в течение 5 минут нажать Привязать Google к аккаунту и пройти Google-вход. Backend проверяет свежую исходную сессию и новую Google identity. Не использовать обычный Continue with Google из гостевого состояния для переноса старого рейтинга: он создаст/откроет отдельный Google-аккаунт. Автоматического объединения по email нет.

Production конфигурация использует Worker ruleshift, отдельный namespace DO и не содержит staging D1 UUID или Google credentials. Секреты должны быть установлены только в ruleshift-2-staging. Совпадающее имя binding ROOMS в двух Workers не делает их namespace общим.

## QA после разрешённой публикации

1. /api/auth/providers должен вернуть google:true; email:false допустим без Resend.
2. Войти Google с отдельным QA-аккаунтом, вернуться в игру, выбрать ник; проверить reload и новый вход после logout.
3. Для старого Passkey-аккаунта проверить link Google и неизменность accountId/рейтинга (не публикуя cookies).
4. Проверить второй аккаунт, двух игроков Online, завершение матча, D1 и Leaderboard после reload.
5. Проверить logout, повтор callback/replay, отмену входа, reconnect/Rematch и мобильный браузер.

URL callback, открытый вручную без flow-cookie/state/code, не является smoke-test успешного входа и должен отклоняться. redirect_uri_mismatch означает несоответствие точного URI; invalid_client — несовместимые ID/secret; 503 до Google redirect может означать credentials/D1/migration/config. Ошибки передавать без code, state, secret и Cookie.

## Проверки подготовки

npm test: 271/271. TypeScript клиента/Worker/MCP и оба staging dry-run выполнены локально. SQLite-проверки не являются полноценным D1 runtime QA. Настоящий вход Google и принятие настроек Google Console не проверены.

Источники:
- https://support.google.com/cloud/answer/15549257 — актуальные OAuth Clients.
- https://support.google.com/cloud/answer/15549945 — Audience/Testing и исключение для basic identity scopes.
- https://developers.google.com/identity/openid-connect/openid-connect — server-side OIDC.
- https://developers.cloudflare.com/workers/configuration/secrets/ — secrets и влияние на deployment.
