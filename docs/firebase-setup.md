# Firebase для push у KidQuest

Ця інструкція готує Cloud Messaging для PWA на Android та iPhone. Дані сім’ї залишаються у PostgreSQL, а вхід — у власній авторизації KidQuest. Firestore, Firebase Authentication, окремі Android/iOS SDK та Firebase Hosting для цього кроку не налаштовуються. Квестик залишається локальним.

## 1. Створіть Firebase-проєкт і Web App

1. Відкрийте [Firebase Console](https://console.firebase.google.com/) та увійдіть у свій Google-акаунт.
2. Натисніть створення проєкту, задайте назву, наприклад `KidQuest Push Test`, і завершіть створення. Необов’язкові Gemini й Google Analytics для цього налаштування можна пропустити.
3. На сторінці проєкту натисніть значок **Web `</>`** або **Add app → Web**. Задайте назву `KidQuest PWA` та натисніть **Register app**. Використовується одна Web App для обох телефонів.
4. Відкрийте **Project settings → General → Your apps → KidQuest PWA → Config**. Звідси потрібні `apiKey`, `projectId`, `messagingSenderId`, `appId`; код `initializeApp` копіювати не потрібно.

Порядок створення проєкту й Web App описаний у [Firebase Web setup](https://firebase.google.com/docs/web/setup).

## 2. Отримайте публічний VAPID-ключ

У тому самому проєкті відкрийте **Project settings → Cloud Messaging → Web configuration → Web Push certificates → Generate Key Pair**. Скопіюйте показаний **публічний** ключ. Якщо пара вже створена, використовуйте її публічний ключ. Це п’яте значення `vapidKey`. [Офіційні кроки FCM Web](https://firebase.google.com/docs/cloud-messaging/web/get-started#configure_web_credentials_with_fcm).

У вкладці Cloud Messaging перевірте, що **Firebase Cloud Messaging API (v1)** увімкнений. Якщо він вимкнений, відкрийте керування API у Google Cloud для **цього самого проєкту** та увімкніть Firebase Cloud Messaging API. [Вимоги серверної відправки](https://firebase.google.com/docs/cloud-messaging/send/v1-api).

Для нових проєктів FCM Registration API зазвичай увімкнений автоматично. Якщо реєстрація браузера повідомляє, що цей API вимкнений, увімкніть саме **FCM Registration API** у вибраному проєкті. Не вмикайте сторонні API для усунення такої помилки. [FCM Web setup](https://firebase.google.com/docs/cloud-messaging/web/get-started).

## 3. Збережіть два локальні JSON-файли

Створіть у корені KidQuest каталог `.local/firebase-input/`.

**Публічна конфігурація:** створіть `.local/firebase-input/web-config.json` і замініть усі позначки своїми значеннями з кроків 1–2:

```json
{
  "apiKey": "REPLACE_WITH_FIREBASE_WEB_API_KEY",
  "projectId": "REPLACE_WITH_PROJECT_ID",
  "messagingSenderId": "REPLACE_WITH_MESSAGING_SENDER_ID",
  "appId": "REPLACE_WITH_WEB_APP_ID",
  "vapidKey": "REPLACE_WITH_PUBLIC_VAPID_KEY"
}
```

Це має бути JSON з подвійними лапками, без `const firebaseConfig =`, коментарів і крапки з комою. Поля Web App та VAPID мають належати одному проєкту. `apiKey` Firebase Web і публічний VAPID використовуються браузером; вони відрізняються від серверного приватного ключа. Firebase пояснює призначення публічних Web API keys у [документації ключів](https://firebase.google.com/docs/projects/api-keys).

**Приватний серверний ключ:** відкрийте **Project settings → Service accounts → Firebase Admin SDK → Generate new private key → Generate key**. Збережіть завантажений JSON як `.local/firebase-input/service-account.json`. Його `project_id` має збігатися з `projectId` Web App. [Офіційна інструкція Admin SDK](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments).

**Не надсилайте service account JSON або `private_key` у чат і не додавайте їх у Git.** Не вставляйте їх у `web-config.json` чи `VITE_*`: ці значення потрапляють до браузера. Потрібен тільки локальний шлях до файла.

## 4. Підготуйте конфігурацію KidQuest

У PowerShell із кореня репозиторію виконайте:

```powershell
pnpm setup:firebase --service-account .local/firebase-input/service-account.json --web-config .local/firebase-input/web-config.json
```

Команда читає локальні файли та готує ігноровані Git результати:

- `.local/firebase/server.env` — приватні серверні значення;
- `.local/firebase/web.env` — публічна конфігурація frontend;
- `.local/firebase/manifest.json` — відомості конфігурації.

Підготовка файлів сама не підтверджує зв’язок із Firebase чи доставку push. Основний кореневий `.env` не змінюється. Якщо конфігурація вже існує, команда відмовить у перезаписі; для навмисної заміни повторіть її з `--replace`. Попередній набір буде збережений у локальному резервному каталозі.

Для вже запущеного мобільного стенда виконайте:

```powershell
pnpm mobile:firebase
pnpm mobile:status
```

`mobile:firebase` підключає саме перевірені файли з `.local/firebase/`, перебудовує frontend із публічними значеннями та оновлює API із серверними значеннями. Команда зберігає поточний Cloudflare-тунель, HTTPS-адресу й дані тестової сім’ї. Під час оновлення API та web можливе коротке переривання доступу. На телефонах після завершення закрийте та знову відкрийте PWA, щоб завантажити оновлений service worker.

Без явного `mobile:firebase` початковий мобільний стенд працює без FCM. Саме заповнення кореневого `.env` або змінних поточного PowerShell не вмикає Firebase на цьому ізольованому стенді. Якщо стенд зупинено, спочатку запустіть `pnpm mobile:start` і використовуйте адресу, яку покаже команда.

## 5. Перевірте на телефонах

Відкрийте актуальне HTTPS-посилання KidQuest. На Android використовуйте Chrome; на iPhone з iOS 16.4+ додайте PWA на початковий екран і відкрийте з іконки. У KidQuest відкрийте «Сповіщення», натисніть **«Увімкнути push»** і надайте дозвіл.

Для Web Push на iPhone не потрібно завантажувати APNs-ключі native iOS застосунка або вступати до Apple Developer Program. Дозвіл запитується після явного натискання у встановленій PWA. [Пояснення WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

Дитиною надішліть тестовий квест, батьками перевірте сповіщення, потім підтвердьте квест і перевірте повідомлення дитини. Із відкритою PWA очікуйте оновлення внутрішньої скриньки й лічильника; ця реалізація не показує окремий системний банер у foreground. Зі згорнутою PWA очікуйте загальне системне повідомлення KidQuest; натискання має відкрити відповідний внутрішній розділ. Внутрішня скринька може працювати незалежно від системного push, тому фонову доставку оцінюють окремо. [Поведінка FCM за станом сторінки](https://firebase.google.com/docs/cloud-messaging/web/receive-messages). Зміна тимчасової HTTPS-адреси потребує нового входу та повторного ввімкнення push для нової адреси.

Станом на 27.10.2026 користувач підтвердив роботу встановленого KidQuest та офлайн-сценарію на Android й iPhone, надання дозволу й увімкнення push, а потім повідомив: «все працює без помилок. сповіщення приходять, на обидва пристрої». Реальну доставку FCM на Android та iPhone зафіксовано як пройдену за повідомленням користувача. Моделі телефонів, версії ОС/браузерів, затримку та окремі результати для відкритої, згорнутої й закритої PWA не зазначено. Докладні результати — у [мобільному QA](mobile-qa.md).

## Результат підключення 27.10.2026

27.10.2026 конфігурацію Firebase застосовано до мобільного стенда. Перевірено авторизацію серверного service account у Google, доступність FCM HTTP v1 через validate-only запит із навмисно невалідним синтетичним токеном, захищений `/notifications/status` із `pushConfigured: true`, узгоджену публічну конфігурацію web/Service Worker та відсутність приватного ключа й серверної email-адреси в 31 публічному JavaScript-файлі. Під час підключення оновилися тільки API та web; контейнери БД і тунелю збережено. Ці перевірки не підтверджують доставку на пристрій. Встановлення й офлайн на Android/iPhone підтверджені раніше; 27.10.2026 користувач також підтвердив надання дозволу та ввімкнення push на обох телефонах. Пізніше цього самого дня користувач підтвердив фактичне отримання сповіщень на Android та iPhone; результат зафіксовано в [мобільному QA](mobile-qa.md).

27.10.2026 після повідомлення користувача про успішне ввімкнення push на обох телефонах серверна перевірка підтвердила дві активні прив’язки: одну для ролі PARENT та одну для CHILD. На момент цієї ранньої серверної перевірки записів PushDelivery ще не було, тому вона підтверджувала лише реєстрацію пристроїв. Наступне повідомлення користувача підтвердило фактичне отримання системних сповіщень на обох телефонах. Токени, імена та email під час цієї перевірки не читались і не виводились.
