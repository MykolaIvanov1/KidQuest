import { test, expect } from '@playwright/test';
import {
  approveTask,
  assertDedicatedServer,
  localNetworkOnly,
  localQueue,
  loginChild,
  navigate,
  newActor,
  prepareFamily,
  readApi,
  submitTaskPhoto,
  taskCard,
  uk,
  type Completion,
  type Transaction,
} from './helpers';

test('offline photo survives a cold reload and a lost delivery response without duplicate completion or points', async ({
  browser,
  page,
  context,
  baseURL,
}, info) => {
  const origin = assertDedicatedServer(baseURL);
  await localNetworkOnly(context, origin);
  const family = await prepareFamily(page, false, origin);
  const actor = await newActor(browser, info, origin);
  try {
    const child = await loginChild(actor.page, family, origin);
    await navigate(actor.page, uk.adventure, '/child/adventure');
    await expect(
      taskCard(actor.page, family.taskTitle).getByRole('button', {
        name: uk.completeTask,
        exact: true,
      }),
    ).toBeEnabled();
    await actor.page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
    await actor.context.setOffline(true);
    await expect(actor.page.getByText(uk.offlineChild, { exact: true })).toBeVisible();
    await submitTaskPhoto(actor.page, family.taskTitle);
    await expect(
      taskCard(actor.page, family.taskTitle).getByText(uk.taskQueued, { exact: true }),
    ).toBeVisible();
    const queued = await localQueue(actor.page);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.photoCount).toBe(1);
    const operationId = queued[0]!.operationId;
    expect(
      await readApi<Completion[]>(page, family.parent.accessToken, '/task-completions', origin),
    ).toHaveLength(0);
    await actor.page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      taskCard(actor.page, family.taskTitle).getByText(uk.taskQueued, { exact: true }),
    ).toBeVisible();
    expect(await localQueue(actor.page)).toEqual([
      expect.objectContaining({ operationId, photoCount: 1 }),
    ]);
    await expect(
      taskCard(actor.page, family.taskTitle).getByRole('button', {
        name: uk.completeTask,
        exact: true,
      }),
    ).toHaveCount(0);
    const faultUrl = 'http://127.0.0.1:4101/__e2e__/drop-submit-response';
    expect((await page.request.post(faultUrl, { data: { taskId: family.taskId } })).ok()).toBe(
      true,
    );
    await actor.context.setOffline(false);
    await expect(
      taskCard(actor.page, family.taskTitle).getByText(uk.taskStates.SUBMITTED, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => localQueue(actor.page), { timeout: 30_000 }).toEqual([]);
    const fault = (await (await page.request.get(faultUrl)).json()) as {
      dropped: boolean;
      operations: string[];
    };
    expect(fault.dropped).toBe(true);
    expect(fault.operations).toEqual([operationId, operationId]);
    const completions = await readApi<Completion[]>(
      page,
      family.parent.accessToken,
      '/task-completions',
      origin,
    );
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      taskId: family.taskId,
      operationId,
      status: 'SUBMITTED',
    });
    expect(completions[0]!.photos).toHaveLength(1);
    expect(
      (await readApi<{ balance: number }>(actor.page, child.accessToken, '/points', origin))
        .balance,
    ).toBe(0);
    expect(
      await readApi<Transaction[]>(actor.page, child.accessToken, '/points/history', origin),
    ).toHaveLength(0);
    await approveTask(page, family, origin);
    const transactions = await readApi<Transaction[]>(
      actor.page,
      child.accessToken,
      '/points/history',
      origin,
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ type: 'TASK_REWARD', amount: family.points });
    expect(
      (await readApi<{ balance: number }>(actor.page, child.accessToken, '/points', origin))
        .balance,
    ).toBe(family.points);
    expect(
      await readApi<Completion[]>(page, family.parent.accessToken, '/task-completions', origin),
    ).toHaveLength(1);
  } catch (error) {
    await info.attach('child-page', {
      body: await actor.page.locator('body').innerText(),
      contentType: 'text/plain',
    });
    await info.attach('child-url', { body: actor.page.url(), contentType: 'text/plain' });
    await info.attach('child-screenshot', {
      body: await actor.page.screenshot(),
      contentType: 'image/png',
    });
    throw error;
  } finally {
    await actor.context.setOffline(false);
    await actor.context.close();
  }
});
