# Production: підготовка й експлуатація

Окремий `docker-compose.prod.yml` запускає PostgreSQL, одноразові Prisma-міграції, API й Caddy. Розробницький `docker-compose.yml` використовується окремо. Команди нижче виконують із кореня репозиторію; приклади запуску призначені для майбутнього сервера після погодження його публікації.

## Стан перевірки

26.10.2026: WSL 3.0.3 і Docker Engine 29.9.2 працюють. Усі три образи (`api`, `web`, `migrate`) успішно зібрані для Linux/AMD64. На окремих нових volumes перевірено шість міграцій, readiness PostgreSQL/API/Caddy, UID 1000 і read-only root filesystem API. Основна сімейна база не переносилась і не змінювалась.

Окремий HTTPS-стенд на loopback із `tls internal` пройшов 11 перевірок авторизації, secure cookies, приватних фото, балів і нагород. Довіру до сертифіката передавали лише тестовому HTTPS-клієнту; системне сховище Windows не змінювали. Compose backup і відновлення в ще один новий project пройшли 9 перевірок, включно з точним журналом/балансом і читанням старого та записом нового фото непривілейованим API. Тестові контейнери зупинено, volumes збережено.

Публічні DNS/ACME-сертифікат, фізичні Android/iPhone та доставка FCM залишаються окремими перевірками. Сайт не опубліковано. Докладний звіт — у [етапі 8](phase-8.md).

## Передумови

- Docker Engine з Linux-контейнерами та сучасним `docker compose`; для локального Docker Desktop на Windows потрібен працездатний WSL 2.
- Для публічного сервера: власний домен, DNS на адресу сервера, доступні TCP 80 і 443, вихідний HTTPS для видачі/оновлення сертифікатів та опційного Firebase.
- Node.js і pnpm потрібні на машині оператора для допоміжних команд; усередині образів використано Node.js 24 і pnpm 11.25.0.
- Постійне сховище Docker та місце для копій PostgreSQL і приватних фотографій.

[Caddy автоматично керує HTTPS і HTTP-перенаправленням](https://caddyserver.com/docs/automatic-https); домен і доступність портів потрібно забезпечити до першого публічного запуску. Ця інструкція сама не змінює DNS чи firewall.

## Змінні середовища

Створіть новий файл із випадковими секретами; команда зберігає вже наявний `.env.production`:

```powershell
pnpm setup:production --domain kidquest.your-domain.tld --email owner@your-domain.tld
```

Підставте власні домен та email. Скрипт створює тільки файл, не запускає служби. Зразок структури — `.env.production.example`. `.env.production` і локальний `.env` не потрапляють до Git чи Docker build context. На сервері обмежте доступ до production-файлу обліковим записом оператора; Windows ACL налаштовують окремо від Unix-параметра `mode`.

| Параметр                                            | Призначення                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `KIDQUEST_DOMAIN`                                   | Лише DNS-ім’я, без протоколу, порту та шляху                                                        |
| `CADDY_EMAIL`                                       | Контакт для TLS-сертифікатів                                                                        |
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` | Початковий користувач і база; пароль генерується скриптом                                           |
| `DATABASE_URL`                                      | Той самий користувач/пароль/база, hostname `db`, порт `5432`; спеціальні символи пароля URL-кодують |
| `JWT_SECRET`                                        | Випадковий серверний секрет; скрипт генерує 48 байтів                                               |
| `JWT_EXPIRATION`, `REFRESH_TOKEN_EXPIRATION`        | Типово `15m` і `30d`                                                                                |
| `KIDQUEST_IMAGE_TAG`                                | Мітка локальної версії образів; змінюйте при підготовці нового релізу                               |

Compose задає API `NODE_ENV=production`, HTTPS `FRONTEND_URL`, `PORT=4000`, `STORAGE_PATH=/app/storage`, `TRUST_PROXY=1`. Останнє відповідає рівно одному прямому reverse proxy Caddy. API не має опублікованого host-порту. Якщо перед Caddy з’явиться ще один proxy/CDN, налаштування довіри й реальної IP-адреси потрібно переглянути.

PostgreSQL використовує `POSTGRES_*` для ініціалізації нового volume: редагування пароля в env не змінює пароль уже створеного користувача БД. Змінюйте пароль у PostgreSQL та конфігурації узгоджено. Зміна JWT-секрета робить старі access tokens недійсними.

Push опційний. Заповніть разом `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` або залиште всі три порожніми. Приватний ключ задають у подвійних лапках із літеральними `\n`, як описано в [інструкції Firebase](phase-4.md). Лише п’ять публічних `VITE_FIREBASE_*` зі зразка передаються frontend під час збірки. Їх зміна потребує повторної збірки web-образу. JWT, пароль БД і Firebase Admin key не є build args. `VITE_API_URL` усередині web-збірки фіксовано як `/api/v1`.

Квестик працює з локальними підказками; зовнішній AI-провайдер вимкнений відповідно до погодженого рішення.

## Перевірка й майбутній запуск

Перевірка конфігурації не запускає контейнери й не друкує підставлені секрети:

```powershell
docker version
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
```

Перед подальшими командами `docker version` має показувати працездатні Client і Server. Повний `docker compose config` містить підставлені секрети; не додавайте його в журнал задачі чи скриншот.

На погодженому сервері після виконання передумов:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps -a
```

API очікує здорової БД та успішного завершення `migrate`; web очікує готового API. `migrate` повинен завершитися з кодом `0`; його статус `Exited (0)` є очікуваним. При помилці міграції API не повинен стартувати. Seed не запускається автоматично: першу сім’ю створюють через реєстрацію. Для вже заповненої локальної БД потрібне окреме перенесення перевіреної копії, а не seed поверх даних.

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api node -e "console.log('uid=' + process.getuid()); fetch('http://127.0.0.1:4000/api/v1/ready').then(async r => { console.log(r.status, await r.text()); if (!r.ok) process.exitCode=1; }).catch(() => process.exitCode=1)"
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail 100 migrate api web
```

Очікується ненульовий UID API й HTTP `200` готовності після підключення до БД. Перевірте HTTPS-адресу, пряме відкриття `/child` і `/parent/quests`, відсутність кешування `/sw.js` та оболонки, 404 для відсутнього `/assets/`-файлу й авторизований доступ до фото через API. Незалогінений запит фото має отримати відмову. Пройдіть [телефонний QA](mobile-qa.md).

## Образи, мережі та дані

- API використовує окремий stage із production dependencies й зібраними backend/packages; запускається користувачем `node`. Згенерований Prisma client переноситься до фактичного pnpm-шляху runtime-пакета. Prisma, bcrypt і Sharp використовують сумісну Debian/glibc основу.
- `migrate` — одноразовий контейнер із Prisma CLI й committed migrations. API не запускає міграції автоматично. Migration stage успадковує workspace зі збірочними залежностями; це окремий операційний образ. У перевіреному Linux runtime optional peers Prisma зберегли Prisma CLI та TypeScript; Playwright до API-образу не потрапив. Подальше зменшення операційних образів є окремою оптимізацією, не зміною перевіреної поведінки.
- Web-образ містить Caddy й готові статичні ресурси. Caddy передає `/api` та `/api/*` в API зі збереженням шляху, решта маршрутів застосунку використовує SPA fallback. Каталог фото не монтується до Caddy.
- Публікуються лише TCP 80 і 443 web-сервісу. PostgreSQL перебуває у внутрішній мережі `database`; API доступний Caddy у мережі `edge`. Контейнерна liveness-перевірка Caddy слухає тільки `127.0.0.1:8080` усередині web.
- Named volumes: `postgres_data` — БД; `photos` — приватні фото; `caddy_data` — TLS-дані; `caddy_config` — дані Caddy. Звичайне перестворення контейнерів їх зберігає. Команда `down -v` видаляє ці дані, тому її не застосовують до робочого проєкту.
- API/migrate/web мають read-only root filesystem і тимчасовий `/tmp`; фото й TLS-дані зберігаються у виділених writable volumes. Compose обмежує журнали драйвером `local`: до трьох файлів по 10 МБ на контейнер.

У build context діє allowlist `.dockerignore`. Серверні секрети передаються тільки під час запуску; вони доступні адміністратору Docker через runtime-конфігурацію. Не передавайте доступ до Docker стороннім обліковим записам.

## Ручна резервна копія

Потрібні узгоджені БД та фото. Зупиніть усі API/worker-процеси, залишивши PostgreSQL увімкненим. Compose-режим скрипта додатково відхиляє копіювання, якщо його API ще працює:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml stop api
pnpm backup --mode compose --env-file .env.production --compose-file docker-compose.prod.yml --writes-paused
docker compose --env-file .env.production -f docker-compose.prod.yml start api
```

Кожен запуск створює новий каталог у `.local/backups/` із `database.dump` у custom-форматі PostgreSQL, `photos/` і `manifest.json` із розмірами та SHA256. Скрипт перевіряє читання dump через `pg_restore --list`; маркер `.incomplete` означає невдалу копію. При помилці перевірте результат команди, виправте причину й створіть нову копію. Повторна перевірка завершеної копії:

```powershell
pnpm backup --verify .local/backups/REPLACE_WITH_BACKUP_DIRECTORY
```

SHA256 перевіряє цілісність файлів; успішний `pg_restore --list` перевіряє структуру архіву. Повне відновлення підтверджують окремим тестом. Збережіть перевірену копію поза диском сервера в захищеному місці. `.env.production` зберігайте окремо із захистом доступу; він не включений до копії даних. Автоматичного backup-сервісу не додано.

## Перевірка відновлення без публікації

Використовуйте окремий Compose project `kidquest-restore` з новими порожніми volumes. Наведені команди не запускають web і не публікують порти. Потрібні вже зібрані образи та завершена перевірена копія; замініть шлях `REPLACE_WITH_BACKUP_DIRECTORY`. Підготуйте ігнорований файл `.env.restore` на основі `.env.production`, залишивши всі три серверні `FIREBASE_*` порожніми: тестове відновлення не повинно надсилати сповіщення з відновленої черги.

```powershell
pnpm backup --verify .local/backups/REPLACE_WITH_BACKUP_DIRECTORY
docker compose -p kidquest-restore --env-file .env.restore -f docker-compose.prod.yml up -d db
docker compose -p kidquest-restore --env-file .env.restore -f docker-compose.prod.yml up --no-start --no-deps --no-build --pull never api
docker compose -p kidquest-restore --env-file .env.restore -f docker-compose.prod.yml cp .local/backups/REPLACE_WITH_BACKUP_DIRECTORY/database.dump db:/tmp/kidquest-restore.dump
docker compose -p kidquest-restore --env-file .env.restore -f docker-compose.prod.yml exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/kidquest-restore.dump'
docker compose -p kidquest-restore --env-file .env.restore -f docker-compose.prod.yml cp .local/backups/REPLACE_WITH_BACKUP_DIRECTORY/photos/. api:/app/storage/
docker compose -p kidquest-restore --env-file .env.restore -f docker-compose.prod.yml up -d --no-deps api
docker compose -p kidquest-restore --env-file .env.restore -f docker-compose.prod.yml exec -T api node -e "fetch('http://127.0.0.1:4000/api/v1/ready').then(r => { console.log(r.status); if (!r.ok) process.exitCode=1; }).catch(() => process.exitCode=1)"
```

Дочекайтеся готовності БД перед `pg_restore`, а API — перед перевіркою ready. Для створення зупиненого API використано перевірену команду `up --no-start --no-deps`; `compose create` не має прапорця `--no-deps` у перевіреній версії CLI. Для використаного раніше `kidquest-restore` оберіть інше нове project name: імпорт розрахований на порожню БД. Після `docker compose cp` перевірте власника фото: runtime API працює з UID/GID `1000:1000`; у новому volume йому потрібні права читати, додавати й видаляти фото. Відновлення до робочого проєкту з існуючими даними потребує окремої зупинки запису, нової страхової копії та погодженого плану заміни. Не запускайте паралельно web recovery-проєкту з production web на тих самих портах.

## Оновлення й журнали

Перед міграціями/оновленням створіть перевірену копію. Підготуйте нову мітку `KIDQUEST_IMAGE_TAG`, зберіть образи, виконайте міграції та перевірте готовність і основний сімейний сценарій. Звичайний відкат лише образу не скасовує міграцію БД; сумісність попередньої версії зі схемою потрібно оцінити заздалегідь.

API пише структуровані журнали в stdout/stderr. Для діагностики використовуйте `logs --tail 100 api`, `logs --tail 100 migrate` і `logs --tail 100 web`; у Caddy доступні операційні/TLS-події, access log окремо не ввімкнений. Не публікуйте env, cookies, токени чи фотографії у звітах.
