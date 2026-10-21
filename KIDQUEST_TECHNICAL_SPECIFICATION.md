# KIDQUEST — ТЕХНІЧНЕ ЗАВДАННЯ ДЛЯ РОЗРОБКИ

Версія: 1.0.0
Статус: ЗАТВЕРДЖЕНО ДО РОЗРОБКИ
Мова інтерфейсу: українська
Назва: KidQuest
Логотип: 🤖⭐ KidQuest
Слоган: «Перетворюємо щоденні справи на захопливі пригоди.»

---

## 1. МЕТА ПРОЄКТУ

KidQuest — сімейний Progressive Web App для дитини 8 років.

Застосунок перетворює щоденні побутові завдання на систему квестів. Дитина виконує завдання, самостійно позначає їх виконаними, після чого батьки перевіряють і підтверджують виконання. Після підтвердження дитина отримує бали, які може використати на заздалегідь створені батьками нагороди.

Застосунок повинен встановлюватися на смартфон як іконка PWA. Окремий повноцінний native mobile application у першій версії не розробляється.

Проєкт створюється перш за все для використання однією сім'єю.

ВАЖЛИВО:
- Не додавати сюжет/історію світу KidQuest.
- Не додавати функції, яких немає в цьому ТЗ, без окремого погодження.
- Це ТЗ є основним джерелом вимог для розробки.

---

## 2. ОСНОВНИЙ СЦЕНАРІЙ

Дитина:
1. Реєструється через email і пароль.
2. Входить у свій акаунт.
3. Бачить головну сторінку.
4. Бачить щоденні завдання.
5. Виконує завдання.
6. Натискає кнопку виконання.
7. За потреби додає фото.
8. Завдання переходить у стан очікування підтвердження.
9. Мама або тато перевіряє виконання.
10. Батько/мати підтверджує або відхиляє виконання.
11. Після підтвердження дитині нараховуються бали.
12. Бали можуть бути витрачені на нагороди.
13. Дитина натискає «Отримати нагороду».
14. Батьки підтверджують отримання нагороди.
15. Бали списуються відповідно до вартості нагороди.

---

## 3. КОРИСТУВАЧІ ТА РОЛІ

### CHILD

Дитина може:
- входити у свій акаунт;
- переглядати завдання;
- відмічати виконання;
- додавати фото до виконання;
- переглядати історію;
- переглядати нагороди;
- запитувати нагороду;
- переглядати баланс балів;
- переглядати Streak;
- переглядати Achievements;
- переглядати календар;
- переглядати графік прогресу;
- отримувати push-сповіщення;
- використовувати AI-помічника Квестика.

### PARENT

У сім'ї передбачено два батьківські акаунти:
- мама;
- тато.

Обидва батьківські акаунти мають права адміністратора сім'ї.

Батьки можуть:
- створювати завдання;
- редагувати завдання;
- видаляти завдання через Soft Delete;
- задавати кількість балів;
- задавати опис завдання;
- задавати категорію;
- визначати необхідність фото;
- перевіряти виконання;
- підтверджувати виконання;
- відхиляти виконання;
- додавати/редагувати/видаляти нагороди;
- задавати вартість нагород;
- підтверджувати запити на нагороди;
- переглядати статистику;
- переглядати календар;
- переглядати журнал входів;
- скидати пароль дитини;
- змінювати email;
- змінювати ролі.

---

## 4. ПІДТРИМКА КІЛЬКОХ ДІТЕЙ

База даних повинна підтримувати кількох дітей в одній сім'ї.

У першій версії UI використовується тільки одна дитина.

Архітектура не повинна бути жорстко прив'язана до одного запису дитини.

---

## 5. ПРИКЛАДИ ЗАВДАНЬ

Приклади:
- застелити постіль після пробудження;
- винести сміття;
- зробити ранкову зарядку;
- прибрати кімнату;
- інші побутові завдання.

Батьки повинні мати можливість самостійно створювати, змінювати та видаляти завдання.

---

# 6. ФУНКЦІОНАЛ

## 6.1 Щоденні завдання

Кожне завдання повинно містити щонайменше:
- назву;
- опис;
- категорію;
- кількість балів;
- статус активності;
- параметр необхідності фото;
- час/період виконання, якщо задано.

## 6.2 Підтвердження

Дитина не отримує бали одразу після натискання «Виконано».

Послідовність:

PENDING → SUBMITTED → APPROVED

Або:

SUBMITTED → REJECTED

Бали нараховуються тільки після APPROVED.

## 6.3 Фото

Одне виконання може містити кілька фотографій.

Фото:
- завантажуються через backend;
- перевіряються за типом і розміром;
- оптимізуються;
- зберігаються окремо від основних даних завдання;
- мають зв'язок із виконанням.

## 6.4 Нагороди

Приклади:
- пограти в планшет;
- купити щось смачне;
- подивитися телевізор;
- інші нагороди, які створюють батьки.

Дитина бачить доступні нагороди та їхню вартість.

## 6.5 Запит нагороди

Дитина натискає:
«Отримати нагороду».

Запит переходить до батьків.

Стани:
- PENDING;
- APPROVED;
- ISSUED;
- REJECTED.

---

# 7. GAMIFICATION

## 7.1 Бали

Бали нараховуються після підтвердження завдання батьками.

Не зберігати баланс як єдине поле, яке довільно змінюється.

Використовувати журнал транзакцій.

Типи транзакцій:
- TASK_REWARD;
- BONUS;
- PENALTY;
- REWARD_PURCHASE;
- ADMIN_ADJUSTMENT.

Баланс обчислюється на основі транзакцій.

## 7.2 Streak

Потрібно реалізувати серію послідовних днів виконання.

Приклад:
7 днів поспіль = Streak 7.

## 7.3 Achievements

Потрібна система досягнень.

Приклади:
- 7 днів поспіль;
- 30 виконаних завдань;
- 100 балів;
- 500 балів.

Досягнення повинні перевірятися автоматично після відповідних подій.

## 7.4 Календар

Дитина та батьки повинні мати можливість переглядати історію виконання за датами.

## 7.5 Графік прогресу

Потрібно показувати прогрес дитини у зрозумілому графічному вигляді.

---

# 8. ГОЛОВНИЙ ЕКРАН ДИТИНИ

Головна сторінка повинна містити:

- привітання, наприклад: «Привіт, Богдан!»;
- поточну дату;
- баланс балів;
- серію виконання;
- прогрес дня у відсотках;
- завдання на сьогодні;
- найближче досягнення;
- доступні нагороди.

Приклад:

Привіт, Богдан! 👋

14 серпня 2026

⭐ 235 балів
🔥 7 днів поспіль

Прогрес дня: 80%

Завдання на сьогодні:
- Застелити постіль +10
- Ранкова зарядка +15
- Винести сміття +10

Найближче досягнення
Доступні нагороди

---

# 9. AI-ПОМІЧНИК

У застосунку передбачити AI-помічника «Квестик».

Квестик — дружній робот-помічник.

Стиль:
- добрий;
- веселий;
- підтримуючий;
- не сварить дитину.

Квестик може:
- вітати дитину;
- мотивувати;
- хвалити;
- коментувати успіхи;
- допомагати з квестами;
- давати позитивні підказки.

Для батьків AI може:
- аналізувати прогрес;
- надавати рекомендації;
- пропонувати квести;
- допомагати з нагородами.

AI повинен бути окремим модулем.

Основний функціонал KidQuest не повинен залежати від доступності AI.

AI не має прямого доступу до бази даних. Backend передає йому тільки необхідний безпечний контекст.

---

# 10. UI/UX

## 10.1 Design System

Використовувати:
- Material Design 3;
- Lucide Icons;
- адаптивний дизайн;
- mobile-first підхід;
- великі touch targets;
- зрозумілі картки;
- доступність.

## 10.2 Теми

Обов'язково:
- Light;
- Dark.

Використовувати design tokens/CSS variables.

## 10.3 Анімації

Використовувати Framer Motion та/або Lottie.

Анімації:
- завершення завдання;
- підтвердження;
- отримання балів;
- досягнення;
- нагорода;
- конфеті після підтвердження.

Анімації не повинні погіршувати продуктивність.

---

# 11. НАВІГАЦІЯ

## Дитина

Нижня навігація:

- 🏠 Головна;
- 🗺️ Пригода;
- 🎁 Нагороди;
- 🏆 Досягнення;
- 👤 Профіль.

ВАЖЛИВО:
«Пригода» — це назва розділу/навігаційного пункту, а не окрема сюжетна історія світу.

## Батьки

- 🏠 Панель;
- 📋 Квести;
- 🎁 Нагороди;
- 📊 Статистика;
- ⚙️ Налаштування.

---

# 12. ТЕХНОЛОГІЇ

## Frontend

- React;
- TypeScript;
- Vite;
- React Router;
- TanStack Query;
- React Hook Form;
- Zod;
- Material Design 3;
- Lucide Icons;
- Framer Motion;
- Lottie;
- PWA;
- Service Worker;
- IndexedDB;
- Dexie.js.

## Backend

- Node.js LTS;
- TypeScript;
- Express;
- Prisma ORM;
- PostgreSQL;
- JWT;
- Refresh Tokens;
- bcrypt;
- Firebase Admin SDK;
- Multer;
- Sharp;
- Winston.

## Infrastructure

- Docker;
- Docker Compose;
- PostgreSQL;
- Firebase Cloud Messaging.

Package manager: pnpm.

---

# 13. СТРУКТУРА ПРОЄКТУ

KidQuest/

├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── shared/
│   ├── types/
│   └── validation/
│
├── prisma/
├── docs/
├── docker/
├── .github/
├── package.json
├── pnpm-workspace.yaml
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md

---

# 14. FRONTEND СТРУКТУРА

apps/web/src/

├── app/
│   ├── router/
│   ├── providers/
│   └── config/
│
├── components/
│   ├── ui/
│   ├── layout/
│   ├── tasks/
│   ├── rewards/
│   ├── achievements/
│   └── mascot/
│
├── features/
│   ├── auth/
│   ├── tasks/
│   ├── rewards/
│   ├── points/
│   ├── achievements/
│   ├── streak/
│   ├── calendar/
│   ├── statistics/
│   ├── notifications/
│   └── ai/
│
├── pages/
│   ├── auth/
│   ├── child/
│   └── parent/
│
├── hooks/
├── services/
├── stores/
├── lib/
├── types/
├── styles/
└── main.tsx

---

# 15. BACKEND СТРУКТУРА

apps/api/src/

├── config/
├── middleware/
├── modules/
│   ├── auth/
│   ├── users/
│   ├── families/
│   ├── children/
│   ├── tasks/
│   ├── task-completions/
│   ├── task-photos/
│   ├── points/
│   ├── rewards/
│   ├── achievements/
│   ├── streak/
│   ├── statistics/
│   ├── notifications/
│   ├── audit/
│   └── ai/
│
├── routes/
├── utils/
├── errors/
├── database/
└── server.ts

Кожен модуль повинен мати чітко розділені:
- controller;
- service;
- repository/data access;
- validation;
- routes;
- types, якщо необхідно.

---

# 16. DATABASE

PostgreSQL + Prisma.

Основні сутності:

- User;
- Family;
- Child;
- Task;
- TaskCategory;
- TaskCompletion;
- TaskPhoto;
- PointTransaction;
- Reward;
- RewardRequest;
- Achievement;
- UserAchievement;
- Notification;
- LoginLog;
- AuditLog;
- RefreshToken;
- Device.

---

# 17. USER

Поля:

- id;
- email;
- passwordHash;
- firstName;
- lastName;
- role;
- avatarUrl;
- isActive;
- createdAt;
- updatedAt;
- deletedAt.

Ролі:
- CHILD;
- PARENT.

---

# 18. FAMILY

Поля:
- id;
- name;
- createdAt;
- updatedAt;
- deletedAt.

Зв'язки:
Family → Users
Family → Children

---

# 19. CHILD

Поля:
- id;
- familyId;
- userId;
- firstName;
- lastName;
- birthDate;
- avatarUrl;
- createdAt;
- updatedAt;
- deletedAt.

---

# 20. TASK

Поля:
- id;
- familyId;
- categoryId;
- title;
- description;
- icon;
- color;
- points;
- isRequired;
- photoRequired;
- startTime;
- endTime;
- isActive;
- createdAt;
- updatedAt;
- deletedAt.

---

# 21. TASK COMPLETION

Стани:
- PENDING;
- SUBMITTED;
- APPROVED;
- REJECTED;
- MISSED.

Основний процес:

PENDING
→ SUBMITTED
→ APPROVED

або:

SUBMITTED
→ REJECTED

Бали нараховуються тільки після APPROVED.

---

# 22. TASK PHOTO

Одне виконання може містити кілька фотографій.

Для фото зберігати metadata:
- id;
- completionId;
- storage path/url;
- MIME type;
- size;
- createdAt.

Файли перевіряти та оптимізувати.

---

# 23. POINT TRANSACTION

Поля повинні дозволяти вести повну історію зміни балів.

Типи:
- TASK_REWARD;
- BONUS;
- PENALTY;
- REWARD_PURCHASE;
- ADMIN_ADJUSTMENT.

Баланс = сума валідних транзакцій.

---

# 24. REWARD

Поля:
- id;
- familyId;
- title;
- description;
- icon;
- imageUrl;
- cost;
- type;
- isActive;
- createdAt;
- updatedAt;
- deletedAt.

Типи:
- SCREEN_TIME;
- FOOD;
- TV;
- ACTIVITY;
- MATERIAL;
- OTHER.

---

# 25. REWARD REQUEST

Стани:
- PENDING;
- APPROVED;
- ISSUED;
- REJECTED.

Процес:

Child
→ «Отримати нагороду»
→ PENDING
→ Parent
→ APPROVED
→ списання балів
→ ISSUED.

Система не повинна дозволяти витратити більше балів, ніж доступно.

Операції зі списанням балів повинні бути транзакційними.

---

# 26. ACHIEVEMENTS

Досягнення повинні перевірятися автоматично.

Приклади:
- 7 днів поспіль;
- 30 виконаних завдань;
- 100 балів;
- 500 балів.

Achievement має містити щонайменше:
- id;
- title;
- description;
- icon;
- condition/configuration;
- isActive.

UserAchievement зберігає факт отримання.

---

# 27. STREAK

Система визначає кількість послідовних днів із виконанням необхідних завдань.

Streak повинен коректно працювати з часовою зоною сім'ї/користувача.

Не можна рахувати майбутній день як виконаний.

---

# 28. CALENDAR

Календар показує історію виконання за датами.

Повинен відображати щонайменше:
- виконано;
- очікує;
- відхилено;
- пропущено.

---

# 29. STATISTICS

Показувати:
- прогрес дня;
- виконані завдання;
- кількість балів;
- Streak;
- досягнення;
- динаміку прогресу;
- історію.

Дані повинні отримуватися через API.

---

# 30. AUTHENTICATION

Реєстрація:
- email;
- password.

Паролі:
- ніколи не зберігати відкритим текстом;
- використовувати bcrypt.

Авторизація:
- Access Token;
- Refresh Token;
- RBAC.

Refresh Token повинен мати механізм відкликання.

Logout повинен відкликати відповідний refresh token.

---

# 31. SECURITY

Обов'язково:
- password hashing;
- JWT validation;
- RBAC;
- rate limiting;
- input validation;
- Zod;
- Prisma;
- XSS protection;
- CSRF protection, де застосовно;
- secure HTTP headers;
- CORS;
- request size limits;
- file upload validation;
- захист від несанкціонованого доступу між сім'ями.

Користувач однієї сім'ї не повинен мати доступ до даних іншої сім'ї.

---

# 32. SOFT DELETE

Основні сутності використовують:

deletedAt

Фізичне видалення не використовувати для звичайного користувацького видалення.

Звичайні API-запити повинні приховувати записи з deletedAt != null.

---

# 33. LOGIN JOURNAL

Зберігати:
- userId;
- loginAt;
- ipAddress;
- userAgent;
- device;
- success.

Батьки можуть переглядати журнал входів.

---

# 34. EMAIL / PASSWORD

Необхідно підтримати:
- реєстрацію;
- login;
- logout;
- скидання пароля дитини;
- зміну email.

Механізм скидання пароля повинен бути безпечним і не розкривати пароль.

---

# 35. FCM

Firebase Cloud Messaging використовується для push notifications.

Дитина:
- нове завдання;
- підтвердження;
- отримані бали;
- досягнення;
- нагорода.

Батьки:
- очікує перевірка завдання;
- запит на нагороду;
- системні повідомлення.

Device token зберігати в БД.

---

# 36. PWA

Обов'язково:
- manifest;
- service worker;
- icons;
- installable;
- responsive;
- offline support;
- automatic sync.

PWA повинна коректно встановлюватися на підтримуваних мобільних браузерах.

---

# 37. OFFLINE

Offline дитина може:
- переглядати доступні завдання;
- переглядати нагороди;
- переглядати історію;
- позначати виконання;
- додавати фото, якщо локальне сховище доступне.

Використовувати:
- IndexedDB;
- Dexie.js;
- Service Worker;
- Sync Queue.

Після появи Internet:
IndexedDB → Sync Queue → API → PostgreSQL.

Кожна операція повинна мати operationId для idempotency.

Потрібно обробляти:
- duplicate sync;
- retry;
- network failure;
- server rejection.

---

# 38. API

Base:
`/api/v1`

Auth:
- POST /auth/register
- POST /auth/login
- POST /auth/refresh
- POST /auth/logout

User:
- GET /me

Tasks:
- GET /tasks
- POST /tasks
- PATCH /tasks/:id
- DELETE /tasks/:id
- POST /tasks/:id/submit

Completions:
- GET /task-completions
- POST /task-completions/:id/approve
- POST /task-completions/:id/reject

Points:
- GET /points
- GET /points/history

Rewards:
- GET /rewards
- POST /rewards
- PATCH /rewards/:id
- DELETE /rewards/:id
- POST /rewards/:id/request

Reward Requests:
- GET /reward-requests
- POST /reward-requests/:id/approve
- POST /reward-requests/:id/reject
- POST /reward-requests/:id/issue

Achievements:
- GET /achievements

Statistics:
- GET /statistics

Calendar:
- GET /calendar

Notifications:
- GET /notifications

AI:
- окремий модуль `/ai/*`.

Усі endpoint повинні мати:
- authentication;
- authorization;
- validation;
- стандартизовані помилки;
- типізовані responses.

---

# 39. API RESPONSE

Успішна відповідь:

{
  "success": true,
  "data": {}
}

Помилка:

{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Некоректні дані",
    "details": []
  }
}

---

# 40. LOCALIZATION

Перша та основна мова:
uk-UA.

Увесь UI повинен бути підготовлений до i18n.

Не hardcode-ити текст безпосередньо в React-компонентах там, де використовується локалізований текст.

---

# 41. VALIDATION

Frontend:
React Hook Form + Zod.

Backend:
Zod.

Backend validation є обов'язковою навіть якщо frontend уже перевірив дані.

---

# 42. RESPONSIVE DESIGN

Першочергово:
- смартфон;
- планшет;
- desktop.

Інтерфейс повинен адаптуватися до різних розмірів екрана.

Touch targets повинні бути достатньо великими для дитини.

---

# 43. ACCESSIBILITY

Реалізувати:
- достатній контраст;
- keyboard navigation там, де застосовно;
- semantic HTML;
- aria-label для необхідних interactive elements;
- зрозумілі повідомлення про помилки;
- reduced motion preference.

---

# 44. TESTING

Unit:
- points;
- streak;
- achievements;
- rewards;
- validation;
- business logic.

Integration:
- authentication;
- tasks;
- completion;
- approval;
- points;
- rewards.

E2E:
1. Register.
2. Login.
3. View task.
4. Complete task.
5. Parent approves.
6. Points added.
7. Child requests reward.
8. Parent approves.
9. Reward issued.

Також протестувати offline sync.

---

# 45. LOGGING

Backend використовує Winston.

Логувати:
- errors;
- authentication events;
- important business events;
- synchronization failures.

Не логувати:
- passwords;
- JWT secrets;
- refresh tokens;
- інші секрети.

---

# 46. ENVIRONMENT VARIABLES

Створити `.env.example`.

Приклад категорій:
- DATABASE_URL;
- JWT_SECRET;
- JWT_REFRESH_SECRET;
- JWT_EXPIRATION;
- REFRESH_TOKEN_EXPIRATION;
- Firebase configuration;
- API URL;
- frontend URL;
- storage configuration.

Реальні секрети не повинні потрапляти до Git.

---

# 47. BACKUP

База PostgreSQL повинна мати можливість резервного копіювання через pg_dump.

Приклад:

pg_dump DATABASE_URL > backup.sql

Не потрібно створювати складну автоматичну backup-систему в першій версії.

---

# 48. CODE QUALITY

Використовувати:
- TypeScript strict mode;
- ESLint;
- Prettier;
- зрозумілі назви;
- маленькі модулі;
- принцип single responsibility;
- DRY;
- KISS;
- SOLID там, де це доречно.

Не дублювати business logic між frontend та backend.

Критична business logic повинна знаходитися на backend.

---

# 49. TRANSACTIONS

PostgreSQL transactions використовувати для критичних операцій.

Особливо:
- підтвердження виконання + нарахування балів;
- списання балів + підтвердження нагороди;
- offline sync batch;
- інші операції, де кілька змін повинні бути атомарними.

---

# 50. AUTHORIZATION

Backend перевіряє:
1. чи користувач авторизований;
2. його роль;
3. його familyId;
4. право на конкретний ресурс.

Ніколи не довіряти familyId, childId або userId, які просто прийшли з frontend.

---

# 51. FRONTEND STATE

Server state:
TanStack Query.

Local/UI state:
відповідний lightweight state management, якщо він реально необхідний.

Не дублювати server state без потреби.

---

# 52. ERROR HANDLING

Frontend повинен мати:
- loading state;
- error state;
- empty state;
- retry;
- offline state.

Backend повинен мати централізований error handler.

Не показувати користувачу stack trace.

---

# 53. PERFORMANCE

Потрібно:
- lazy loading сторінок;
- оптимізація зображень;
- code splitting;
- кешування API;
- мінімізація зайвих запитів;
- оптимізація IndexedDB;
- оптимізація service worker.

---

# 54. НЕ ДОДАВАТИ БЕЗ ПОГОДЖЕННЯ

Codex не повинен самостійно додавати:
- нові ролі;
- соціальну систему;
- чат між користувачами;
- рекламу;
- платежі;
- сюжетну гру;
- multiplayer;
- сторонні аналітичні системи;
- додаткові бази даних;
- нові зовнішні сервіси;
- нові великі функціональні модулі.

Якщо потрібна нова функція — спочатку повідомити про необхідність.

---

# 55. ПОРЯДОК РОЗРОБКИ

## Phase 1 — Project Setup

001. Monorepo.
002. pnpm.
003. TypeScript.
004. React/Vite.
005. Express.
006. Docker Compose.
007. PostgreSQL.
008. Prisma.
009. ESLint.
010. Prettier.
011. Environment configuration.

## Phase 2 — Database

012. Prisma schema.
013. Relations.
014. Indexes.
015. Soft Delete.
016. Migrations.
017. Seed.

## Phase 3 — Authentication

018. Registration.
019. Login.
020. JWT.
021. Refresh token.
022. Logout.
023. RBAC.
024. Password reset.
025. Change email.
026. Login journal.

## Phase 4 — Family / Users

027. Family.
028. Parents.
029. Child.
030. Multi-child DB support.

## Phase 5 — Tasks

031. Task categories.
032. CRUD tasks.
033. Daily task logic.
034. Task completion.
035. Parent approval.
036. Rejection.
037. Photo upload.
038. Photo optimization.

## Phase 6 — Points

039. Point transactions.
040. Balance.
041. Automatic points after approval.

## Phase 7 — Rewards

042. Reward CRUD.
043. Reward request.
044. Parent approval.
045. Points deduction.
046. Reward issued.

## Phase 8 — Gamification

047. Achievements.
048. Streak.
049. Calendar.
050. Progress statistics.

## Phase 9 — Notifications

051. Firebase.
052. Device tokens.
053. Push notifications.

## Phase 10 — Frontend

054. Design system.
055. Authentication.
056. Child dashboard.
057. Parent dashboard.
058. Tasks.
059. Rewards.
060. Achievements.
061. Calendar.
062. Statistics.
063. Profile.
064. Notifications.
065. Animations.
066. Confetti.
067. Dark theme.

## Phase 11 — PWA

068. Manifest.
069. Service Worker.
070. Installability.
071. IndexedDB.
072. Offline cache.
073. Sync Queue.
074. Automatic synchronization.
075. Retry/conflict handling.

## Phase 12 — AI

076. AI module.
077. Questyk UI.
078. Safe context generation.
079. AI integration.
080. Error/fallback handling.

## Phase 13 — Testing

081. Unit tests.
082. Integration tests.
083. E2E.
084. Offline tests.
085. Security tests.

## Phase 14 — Production

086. Production Docker.
087. Environment configuration.
088. PostgreSQL backup.
089. Logging.
090. Documentation.
091. Final QA.

---

# 56. DEFINITION OF DONE

Задача вважається виконаною, коли:
- реалізована функція;
- TypeScript проходить;
- ESLint проходить;
- форматування проходить;
- unit/integration tests, де вони передбачені, проходять;
- API протестований;
- UI адаптивний;
- loading/error/empty states реалізовані;
- security rules дотримані;
- документація оновлена;
- існуючий функціонал не зламаний.

---

# 57. ГОЛОВНЕ ПРАВИЛО ДЛЯ CODEX

Працювати тільки з поточною задачею.

Не переходити до наступної задачі автоматично.

Не переписувати великі частини проєкту без необхідності.

Не змінювати затверджену архітектуру без дозволу.

Якщо вимоги суперечать одна одній або для реалізації потрібне нове архітектурне рішення:
1. зупинитися;
2. пояснити проблему;
3. запропонувати рішення;
4. чекати підтвердження.

Після завершення кожної задачі показати:
- що зроблено;
- які файли створені/змінені;
- які команди перевірки виконані;
- результати тестів;
- відомі проблеми.

---

# 58. ПЕРШИЙ ПРОМПТ ДЛЯ CODEX

Після створення цього файлу в корені репозиторію використати:

«Прочитай KIDQUEST_TECHNICAL_SPECIFICATION.md.

Ти працюєш як Senior Full-Stack Engineer над KidQuest.

ТЗ є головним джерелом вимог.

Не додавай функції, яких немає в ТЗ.
Не змінюй архітектуру без мого дозволу.
Не переходь до наступної задачі автоматично.

Почни тільки з Phase 1, Task 001 — створення базової структури monorepo.

Після завершення:
1. покажи створені та змінені файли;
2. виконай необхідні перевірки;
3. покажи результати;
4. повідом про помилки, якщо вони є;
5. зупинися та чекай наступної команди.»

---

# 59. ФІНАЛЬНИЙ РЕЗУЛЬТАТ

Результатом має бути повністю працездатний KidQuest:

- PWA;
- український інтерфейс;
- Child + Parent roles;
- два батьківські акаунти;
- підтримка кількох дітей на рівні БД;
- щоденні квести;
- підтвердження батьками;
- бали;
- нагороди;
- Achievements;
- Streak;
- календар;
- статистика;
- push notifications через FCM;
- фото;
- Light/Dark theme;
- offline mode;
- automatic synchronization;
- AI-помічник Квестик;
- PostgreSQL;
- Node.js;
- React;
- Material Design 3;
- Lucide Icons;
- безпечна авторизація;
- Soft Delete;
- журнал входів;
- резервне копіювання БД;
- тести;
- документація.

Кінець технічного завдання.
