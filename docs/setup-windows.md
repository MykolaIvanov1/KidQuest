# Запуск KidQuest на Windows

## Передумови

- Node.js 22.12 або новіший із гілки 22 LTS.
- pnpm 11.25.0; версія зафіксована у `package.json`.
- Docker Desktop із підтримкою Linux containers, запущений Docker Engine.
- PowerShell у корені KidQuest.

Якщо команда `pnpm` недоступна, встановіть її через `npm install --global pnpm@11.25.0`. Якщо PowerShell блокує shim-скрипт, використовуйте `pnpm.cmd` та `npm.cmd`.

## Якщо Docker Desktop не запускається

Перевірте `wsl --status` і `docker version`. Якщо Windows повідомляє, що WSL не встановлено, відкрийте PowerShell **від імені адміністратора**:

```powershell
wsl --install --no-distribution
```

Дочекайтеся завершення й перезавантажте Windows, якщо інсталятор цього потребує. Після запуску Docker Desktop увімкніть WSL 2 engine та Linux containers. Команда `docker version` має показати і Client, і Server без помилки. Якщо WSL уже встановлено, перевірте `wsl --update` та повідомлення самого Docker Desktop; причину не можна визначити лише за наявністю Docker CLI.

Команда встановлює компонент WSL без окремого Linux-дистрибутива. Джерела: [Microsoft WSL](https://learn.microsoft.com/en-us/windows/wsl/basic-commands#install), [Docker Desktop для Windows](https://docs.docker.com/desktop/setup/install/windows-install/). 24.10.2026 на цьому комп’ютері був відсутній WSL. Станом на 26.10.2026 WSL і Docker Engine встановлені та працюють; Linux-образи, HTTPS API та Compose backup/restore перевірені на окремих тестових даних. Наявна сімейна база продовжує працювати з локальним PostgreSQL.

## Конфігурація

```powershell
pnpm install
pnpm setup:env
```

Команда створює кореневий `.env` з випадковими локальними секретами. Альтернатива для ручного налаштування:

```powershell
Copy-Item .env.example .env
```

У ручному варіанті замініть усі позначені значення для паролів і JWT. `DATABASE_URL` має відповідати користувачу, паролю, порту та назві бази з Compose. Значення адрес frontend та API повинні узгоджуватися з CORS і налаштуваннями Vite. Жодного секрету не додавайте до Git або змінних `VITE_*`: останні потрапляють у браузерний код.

## База даних та застосунок

```powershell
docker compose up -d
docker compose ps
pnpm db:generate
pnpm db:deploy
pnpm dev
```

`db:deploy` застосовує наявні міграції. `db:generate` створює Prisma Client. Відкрийте [http://localhost:5173](http://localhost:5173). Backend за замовчуванням працює на порту 4000; Vite передає API-запити через proxy.

Якщо Windows блокує порт PostgreSQL `5432`, виберіть інший вільний порт, наприклад `56179`. Для Docker задайте `POSTGRES_PORT=56179` у локальному `.env` і той самий порт у `DATABASE_URL`. Для окремо встановленого PostgreSQL запустіть сервер із цим портом. Frontend залишається на `5173`, а backend — на `4000`.

Спочатку зареєструйте батьківський акаунт. Це також створить сім'ю. З батьківської панелі додайте дитину та, за потреби, другого з батьків. Приєднання до сім'ї контролює авторизований батьківський акаунт; довільний `familyId` від браузера не використовується.

Seed необов'язковий. Для нього явно задайте email і паролі батьків та дитини через `SEED_PARENT_EMAIL`, `SEED_PARENT_PASSWORD`, `SEED_CHILD_EMAIL`, `SEED_CHILD_PASSWORD`, після чого виконайте `pnpm db:seed`. Паролі для seed мають містити щонайменше 12 символів і до 72 байтів UTF-8. Повторний seed не змінює паролі наявних облікових записів. Прикладів готових паролів у репозиторії немає.

Якщо PostgreSQL вже встановлено локально, Docker не потрібний: створіть окрему базу та користувача, задайте власний `DATABASE_URL` у `.env`, потім виконайте команди Prisma. Застосунок використовує PostgreSQL, без додаткових баз даних.

## Поточна локальна база без Docker

На цьому комп’ютері застосунок уже використовує окремий PostgreSQL 17 у `.local/dev-postgres/data` на `127.0.0.1:56179`; його конфігурація збережена в ігнорованому `.env`. Docker volume — інше сховище: встановлення Docker саме не переносить ці сімейні дані. Перед перемиканням на Docker потрібно зробити перевірену копію й перенести БД та фото за [backup.md](backup.md).

Після перезавантаження Windows перевірте стан локального сервера:

```powershell
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' status -D '.local/dev-postgres/data'
```

Лише якщо він не запущений, запустіть його з тим самим каталогом і портом:

```powershell
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' start -D '.local/dev-postgres/data' -o '-p 56179 -h 127.0.0.1' -l '.local/dev-postgres/server.log'
```

Після збірки (`pnpm build`) запустіть `pnpm --filter @kidquest/backend start`, а в іншому PowerShell — `pnpm --filter @kidquest/frontend preview --port 5173 --strictPort`. Відкривайте саме `http://localhost:5173`, що відповідає поточному FRONTEND_URL. Це локальний production preview для QA, а не публічний сервер. Для роботи над кодом замість цих двох процесів використовуйте `pnpm dev`.

## Тести з PostgreSQL

`pnpm test` завжди запускає HTTP-перевірки з in-memory адаптером. Щоб додати ті самі перевірки реального Prisma-репозиторію, створіть окрему PostgreSQL-базу, застосуйте до неї міграції та передайте її URL у змінній середовища `DATABASE_TEST_URL` перед запуском `pnpm test`. Для застосування міграції тимчасово задайте `DATABASE_URL` тієї самої тестової бази в поточному процесі PowerShell. Після перевірки відновіть робочу конфігурацію. Не використовуйте сімейну базу для тестів.

Для локального QA також підтримується не відстежуваний Git файл `.local/test-db.env` з одним значенням `DATABASE_TEST_URL`; backend-тести читають його автоматично. Цей файл потрібний лише розробнику, не для звичайного запуску застосунку.

З налаштованою тестовою базою також виконайте `pnpm db:test`: ця команда перевіряє обмеження PostgreSQL та відкочує всі власні тестові записи.

## Зупинка та дані

Зупиніть процеси розробки через `Ctrl+C`. Команда `docker compose down` зупиняє контейнер, зберігаючи volume бази. `docker compose down --volumes` видаляє локальні дані — не використовуйте її, якщо їх потрібно зберегти.

Для узгодженої копії зупиніть процеси API/worker та використайте скрипт, що копіює і БД, і приватні фото:

```powershell
pnpm backup --pg-bin 'C:/Program Files/PostgreSQL/17/bin' --writes-paused
```

Потрібні встановлені PostgreSQL client tools; після завершення знову запустіть API. Дані копії приватні та не повинні потрапляти до Git. Параметри для Docker, перевірка SHA256 і відновлення в порожню БД описані в [backup.md](backup.md).

Браузерний прогін Chromium/WebKit з окремою базою описано в [phase-8.md](phase-8.md). Для майбутнього серверного розгортання використовуйте [production.md](production.md); для перевірки на телефонах — [mobile-qa.md](mobile-qa.md).

## PWA та зовнішні налаштування

PWA перевіряйте з production build/preview. Щоб залишити очікуваний frontend origin, зупиніть dev-сервер frontend, побудуйте проєкт і запустіть preview на тому самому порту, з активним backend:

```powershell
pnpm build
pnpm --filter @kidquest/backend dev
```

В іншому вікні PowerShell:

```powershell
pnpm --filter @kidquest/frontend preview --port 5173 --strictPort
```

Service worker потребує HTTPS або `localhost`; проста HTTP-адреса комп'ютера в локальній мережі на телефоні не є еквівалентом HTTPS. Для іншої адреси frontend відповідно змініть `FRONTEND_URL` у локальному `.env` та перезапустіть backend.

Основні можливості та сповіщення всередині застосунку працюють без зовнішніх ключів. Для push заповніть Firebase-змінні за [інструкцією](phase-4.md). Офлайн-перегляд і черга виконань з фото реалізовані; перевіряйте їх з production build/preview за [інструкцією](phase-6.md). Квестик працює в локальному режимі без AI-ключа; підключення зовнішнього провайдера описане в [документації модуля](phase-7.md). Встановлення PWA та доставку push на фізичний телефон потрібно перевірити з HTTPS і налаштованим Firebase.

## KidQuest як сервер на цьому ПК

Для щоденного доступу з Android/iPhone використовується наявний ізольований Docker-проєкт із сімейною БД та фото. Погоджений Tailscale Funnel забезпечує постійну HTTPS-адресу без оренди VPS. `pnpm pc:start` відновлює збережений deployment без перебудови й створення нової сім’ї; `pnpm pc:status` показує актуальне посилання. Автозапуск після входу користувача Windows перевіряється через `pnpm pc:startup status`. Інструкція — [pc-hosting.md](pc-hosting.md).

На цій машині автосон від розетки вже вимкнений; налаштування живлення під час підготовки сервера не змінювалися. Робота від батареї, закриття кришки, ручний сон, вихід із Windows або вимкнення ПК можуть перервати доступ. Після переходу на постійну адресу потрібно один раз увійти на телефонах, встановити PWA для нової адреси та знову ввімкнути push. Попередні акаунти й серверні дані збережені.
