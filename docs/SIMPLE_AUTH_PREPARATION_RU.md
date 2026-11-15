# SIMPLE AUTH: локальная подготовка

Статус: серверные компоненты подготовлены; Google/email подключены к игровому UI; ненастроенные провайдеры отключены. Настоящая доставка email и браузерный Google OAuth не проверены. Опубликованные окружения не изменены.

## Resend

Важно: wrangler secret put и сохранение secrets через Cloudflare Dashboard с Deploy изменяют опубликованный Worker. Все такие шаги требуют отдельного разрешения.

1. Создать аккаунт Resend и подтвердить свой домен, добавив предложенные Resend DNS-записи. Не использовать тестовый отправитель для входа произвольных пользователей.
2. Создать API key с разрешением отправки и ограничением на подтверждённый домен.
3. После отдельного разрешения настроить для staging секреты (значения вводить только в интерактивный запрос):

```powershell
npx wrangler secret put RESEND_API_KEY --config wrangler.staging-leaderboard.jsonc
npx wrangler secret put AUTH_CODE_SECRET --config wrangler.staging-leaderboard.jsonc
```

AUTH_CODE_SECRET: минимум 32 символа криптографически случайного секрета; рекомендовано 32 случайных байта в hex. Генерировать в менеджере паролей, не публиковать в чате, репозитории или логах. EMAIL_FROM — подтверждённый адрес отправителя, задаётся отдельно в vars staging-конфигурации. Ни одно из этих действий сейчас не выполнено.

POST /api/auth/email/start: JSON email, name, locale (ru/en), link (optional). Сервер хранит HMAC кода и flow-cookie HttpOnly/Secure/SameSite=Strict, срок 5 минут, 5 попыток; отдельные лимиты IP, адреса и общего числа отправок. Лимит адреса возвращает такой же 202, без раскрытия наличия аккаунта. POST /api/auth/email/verify: JSON code; успешный вход выдаёт защищённую сессию. Без всех настроек start возвращает 503 и не отправляет письмо.

## Google

Создать OAuth client типа Web application. Redirect URI staging строго:
https://ruleshift-2-staging.zamusik-play.workers.dev/api/auth/google/callback

Для подготовленного rollout оба GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET вводятся как staging Worker Secrets (Client ID сам по себе не конфиденциален). Обычный wrangler secret put сразу публикует новую версию Worker, поэтому без разрешения эти команды не запускать. Точная пошаговая инструкция: GOOGLE_LOGIN_STAGING_SETUP_RU.md. Не добавлять реальные значения сейчас.

POST /api/auth/google/start возвращает authorize URL. Callback использует одноразовый state, nonce, PKCE S256, проверку RSA-подписи Google ID token, issuer, audience, срока и azp. Отдельная OAuth-cookie SameSite=Lax нужна для внешнего redirect; session-cookie остаётся Strict. Email и Google идентифицируются отдельно; автоматического объединения по email нет. Привязка link=true требует свежую существующую сессию и повторную проверку после доказательства новой личности.

## Миграция и граница разрешений

0004_simple_auth.sql добавляет auth_identities, login_flows и account_nickname_choices, не удаляет старые аккаунты или рейтинги. Применение к удалённой базе и deployment требуют отдельного разрешения. Подготовленная команда (сейчас НЕ запускать):

```powershell
npx wrangler d1 migrations apply ruleshift-2-staging-rankings --remote --config wrangler.staging-leaderboard.jsonc
```

Откат к прежней версии Worker: оставить новые таблицы без удаления данных, не откатывать базу destructive SQL. Production настройки и ресурсы раздельные.

## Проверки и оставшаяся работа

Локальные тесты используют SQLite-адаптер D1 и подменённую доставку; это не подтверждение работы реального D1/Resend. Google тесты проверяют реальные криптографические подписи тестовых JWT, не реальный вход Google. Auth UI, гостевой запуск и синхронизация никнеймов реализованы локально. Требуется проверить реальные Google/email-входы, привязку, logout, replay, доставку и сохранение рейтинга. Подробнее: SIMPLE_AUTH_NICKNAMES_QA_RU.md.

Документация провайдеров: https://resend.com/docs/api-reference/emails/send-email и https://developers.google.com/identity/openid-connect/openid-connect
