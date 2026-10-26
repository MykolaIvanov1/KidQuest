import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  expect,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
  type TestInfo,
} from '@playwright/test';
import { uk } from '../frontend/src/lib/i18n';

export const E2E_BASE_URL = 'http://127.0.0.1:5180';
export interface Session {
  accessToken: string;
  user: { id: string; familyId: string; firstName: string; role: 'PARENT' | 'CHILD' };
}
export interface Completion {
  id: string;
  taskId: string;
  operationId: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  photos: { id: string; url: string }[];
}
export interface Transaction {
  id: string;
  type: string;
  amount: number;
  description: string;
}
export interface RewardRequest {
  id: string;
  rewardId: string;
  status: 'PENDING' | 'APPROVED' | 'ISSUED' | 'REJECTED';
}
export interface FamilyFixture {
  parent: Session;
  parentName: string;
  childName: string;
  childEmail: string;
  password: string;
  taskId: string;
  taskTitle: string;
  points: number;
  rewardId: string | null;
  rewardTitle: string;
  rewardCost: number;
}
export function assertDedicatedServer(baseURL = E2E_BASE_URL) {
  const url = new URL(baseURL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5180') {
    throw new Error('KidQuest E2E requires the isolated loopback server on port 5180.');
  }
  return url.origin;
}
export async function localNetworkOnly(context: BrowserContext, baseURL = E2E_BASE_URL) {
  const origin = assertDedicatedServer(baseURL);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || ['data:', 'blob:'].includes(url.protocol)
      ? route.continue()
      : route.abort('blockedbyclient');
  });
}
export async function newActor(browser: Browser, info: TestInfo, baseURL = E2E_BASE_URL) {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: assertDedicatedServer(baseURL),
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    locale: use.locale || 'uk-UA',
    timezoneId: use.timezoneId || 'Europe/Kyiv',
    serviceWorkers: 'allow',
    reducedMotion: 'reduce',
  });
  await localNetworkOnly(context, baseURL);
  return { context, page: await context.newPage() };
}
export async function data<T>(response: Pick<APIResponse, 'ok' | 'status' | 'json'>): Promise<T> {
  expect(response.ok(), `API response status ${response.status()}`).toBe(true);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success).toBe(true);
  return body.data;
}
export function apiResponse(page: Page, path: string, method = 'POST'): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1${path}` &&
      response.request().method() === method,
  );
}
export async function actionData<T>(
  page: Page,
  path: string,
  action: () => Promise<unknown>,
  method = 'POST',
) {
  const received = apiResponse(page, path, method);
  const [response] = await Promise.all([received, action()]);
  return data<T>(response);
}
export async function readApi<T>(
  page: Page,
  token: string,
  path: string,
  baseURL = E2E_BASE_URL,
): Promise<T> {
  return data<T>(
    await page.request.get(new URL(`/api/v1${path}`, assertDedicatedServer(baseURL)).href, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}
export async function navigate(page: Page, label: string, path: string) {
  await page
    .getByRole('link', { name: label, exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
}
export function taskCard(page: Page, title: string): Locator {
  return page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}
export function rewardCard(page: Page, title: string): Locator {
  return page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}
export async function prepareFamily(
  page: Page,
  withReward = true,
  baseURL = E2E_BASE_URL,
): Promise<FamilyFixture> {
  const suffix = randomUUID().slice(0, 8);
  const parentName = `Олена ${suffix}`;
  const childName = `Богдан ${suffix}`;
  const password = `KidQuest-e2e-${randomUUID()}!`;
  const parentEmail = `e2e-parent-${suffix}@example.test`;
  const childEmail = `e2e-child-${suffix}@example.test`;
  const taskTitle = `Скласти іграшки ${suffix}`;
  const rewardTitle = `Настільна гра ${suffix}`;
  const categoryName = `Домашні справи ${suffix}`;
  await page.goto(`${assertDedicatedServer(baseURL)}/register`);
  await page.getByLabel(uk.firstName, { exact: true }).fill(parentName);
  await page.getByLabel(uk.familyName, { exact: true }).fill(`E2E Родина ${suffix}`);
  await page.getByLabel(uk.email, { exact: true }).fill(parentEmail);
  await page.getByLabel(/^Пароль/).fill(password);
  const parent = await actionData<Session>(page, '/auth/register', () =>
    page.getByRole('button', { name: uk.register, exact: true }).click(),
  );
  await expect(page).toHaveURL(/\/parent$/);
  await expect(
    page.getByRole('heading', { name: uk.greeting(parentName), exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: uk.addMember, exact: true }).click();
  await page.getByLabel(uk.firstName, { exact: true }).fill(childName);
  await page.getByRole('combobox', { name: uk.memberRole, exact: true }).selectOption('CHILD');
  await page.getByLabel(uk.email, { exact: true }).fill(childEmail);
  await page.getByLabel(/^Пароль/).fill(password);
  await actionData(page, '/family/members', () =>
    page.getByRole('button', { name: uk.memberSubmit, exact: true }).click(),
  );
  await expect(page.getByText(uk.memberSuccess, { exact: true })).toBeVisible();
  await navigate(page, uk.quests, '/parent/quests');
  await page.getByText(uk.newCategory, { exact: true }).click();
  await page.getByLabel(uk.categoryName, { exact: true }).fill(categoryName);
  const category = await actionData<{ id: string }>(page, '/task-categories', () =>
    page.getByRole('button', { name: uk.addCategory, exact: true }).click(),
  );
  await page.getByRole('button', { name: uk.newTask, exact: true }).click();
  const taskForm = page.getByRole('region', { name: uk.newTask, exact: true });
  await taskForm.getByLabel(uk.title, { exact: true }).fill(taskTitle);
  await taskForm
    .getByLabel(uk.description, { exact: true })
    .fill('Склади іграшки на полицю та додай тестове фото.');
  await taskForm
    .getByRole('combobox', { name: uk.category, exact: true })
    .selectOption(category.id);
  await taskForm.getByLabel(uk.taskPoints, { exact: true }).fill('40');
  await taskForm.getByLabel(uk.requirePhoto, { exact: true }).check();
  const task = await actionData<{ id: string }>(page, '/tasks', () =>
    taskForm.getByRole('button', { name: uk.save, exact: true }).click(),
  );
  await expect(taskForm).not.toBeVisible();
  await expect(taskCard(page, taskTitle)).toBeVisible();
  let rewardId: string | null = null;
  if (withReward) {
    await navigate(page, uk.rewards, '/parent/rewards');
    await page.getByRole('button', { name: uk.newReward, exact: true }).click();
    const rewardForm = page.getByRole('region', { name: uk.newReward, exact: true });
    await rewardForm.getByLabel(uk.title, { exact: true }).fill(rewardTitle);
    await rewardForm
      .getByLabel(uk.description, { exact: true })
      .fill('Спільна сімейна настільна гра.');
    await rewardForm.getByLabel(uk.cost, { exact: true }).fill('25');
    await rewardForm
      .getByRole('combobox', { name: uk.rewardType, exact: true })
      .selectOption('ACTIVITY');
    rewardId = (
      await actionData<{ id: string }>(page, '/rewards', () =>
        rewardForm.getByRole('button', { name: uk.save, exact: true }).click(),
      )
    ).id;
    await expect(rewardForm).not.toBeVisible();
  }
  return {
    parent,
    parentName,
    childName,
    childEmail,
    password,
    taskId: task.id,
    taskTitle,
    points: 40,
    rewardId,
    rewardTitle,
    rewardCost: 25,
  };
}
export async function loginChild(page: Page, fixture: FamilyFixture, baseURL = E2E_BASE_URL) {
  await page.goto(`${assertDedicatedServer(baseURL)}/login`);
  await page.getByLabel(uk.email, { exact: true }).fill(fixture.childEmail);
  await page.getByLabel(/^Пароль/).fill(fixture.password);
  const session = await actionData<Session>(page, '/auth/login', () =>
    page.getByRole('button', { name: uk.login, exact: true }).click(),
  );
  await expect(page).toHaveURL(/\/child$/);
  await expect(
    page.getByRole('heading', { name: uk.greeting(fixture.childName), exact: true }),
  ).toBeVisible();
  return session;
}
function chunk(name: string, payload: Buffer) {
  const type = Buffer.from(name);
  const content = Buffer.concat([type, payload]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, content, checksum]);
}
/** A generated 1×1 RGBA PNG. No personal photo or external fixture is used. */
export function syntheticPhoto() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return {
    name: 'kidquest-e2e.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.from([0, 41, 99, 76, 255]))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  };
}
export async function submitTaskPhoto(page: Page, title: string) {
  const card = taskCard(page, title);
  await expect(card.getByRole('button', { name: uk.completeTask, exact: true })).toBeEnabled();
  await card.getByRole('button', { name: uk.completeTask, exact: true }).click();
  await card.getByLabel(/^Фото виконання/).setInputFiles(syntheticPhoto());
  await card.getByRole('button', { name: uk.taskQueueSubmit, exact: true }).click();
}
export async function approveTask(page: Page, fixture: FamilyFixture, baseURL = E2E_BASE_URL) {
  // A fresh navigation also verifies that the parent session survives a real reload.
  await page.goto(`${assertDedicatedServer(baseURL)}/parent`);
  const review = taskCard(page, fixture.taskTitle);
  await expect(review).toHaveCount(1);
  await review.getByRole('button', { name: /^Переглянути фото/ }).click();
  const image = review.getByRole('img', { name: uk.photoAlt(0), exact: true });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const completion = await actionData<Completion>(
    page,
    `/task-completions/${(await readApi<Completion[]>(page, fixture.parent.accessToken, '/task-completions?status=SUBMITTED', baseURL))[0]!.id}/approve`,
    () => review.getByRole('button', { name: uk.approve, exact: true }).click(),
  );
  expect(completion.status).toBe('APPROVED');
  await expect(page.getByText(uk.approvedPoints(fixture.points), { exact: true })).toBeVisible();
  return completion;
}
export async function localQueue(page: Page) {
  return page.evaluate(
    async () =>
      new Promise<{ operationId: string; photoCount: number; status: string }[]>(
        (resolve, reject) => {
          const opening = indexedDB.open('kidquest-offline-v1');
          opening.onerror = () =>
            reject(new Error(opening.error?.message || 'Cannot open offline store'));
          opening.onsuccess = () => {
            const database = opening.result;
            const transaction = database.transaction('queue', 'readonly');
            const read = transaction.objectStore('queue').getAll();
            read.onerror = () =>
              reject(new Error(read.error?.message || 'Cannot read offline queue'));
            read.onsuccess = () => {
              const rows = read.result as {
                operationId: string;
                photos: unknown[];
                status: string;
              }[];
              resolve(
                rows.map((row) => ({
                  operationId: row.operationId,
                  photoCount: row.photos.length,
                  status: row.status,
                })),
              );
            };
            transaction.oncomplete = () => database.close();
          };
        },
      ),
  );
}
export { uk };
