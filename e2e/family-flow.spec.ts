import { test, expect } from '@playwright/test';
import {
  actionData,
  approveTask,
  assertDedicatedServer,
  localNetworkOnly,
  loginChild,
  navigate,
  newActor,
  prepareFamily,
  readApi,
  rewardCard,
  submitTaskPhoto,
  taskCard,
  uk,
  type Completion,
  type RewardRequest,
  type Transaction,
} from './helpers';

test('family completes a photographed quest and receives one purchased reward through the Ukrainian UI', async ({
  browser,
  page,
  context,
  baseURL,
}, info) => {
  const origin = assertDedicatedServer(baseURL);
  await localNetworkOnly(context, origin);
  const family = await prepareFamily(page, true, origin);
  const actor = await newActor(browser, info, origin);
  try {
    const child = await loginChild(actor.page, family, origin);
    await navigate(actor.page, uk.adventure, '/child/adventure');
    await submitTaskPhoto(actor.page, family.taskTitle);
    await expect(
      taskCard(actor.page, family.taskTitle).getByText(uk.taskStates.SUBMITTED, { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const submitted = await readApi<Completion[]>(
      page,
      family.parent.accessToken,
      '/task-completions',
      origin,
    );
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ taskId: family.taskId, status: 'SUBMITTED' });
    expect(submitted[0]!.photos).toHaveLength(1);
    expect(
      (await readApi<{ balance: number }>(actor.page, child.accessToken, '/points', origin))
        .balance,
    ).toBe(0);
    expect(
      await readApi<Transaction[]>(actor.page, child.accessToken, '/points/history', origin),
    ).toHaveLength(0);
    await approveTask(page, family, origin);
    expect(
      (await readApi<{ balance: number }>(actor.page, child.accessToken, '/points', origin))
        .balance,
    ).toBe(family.points);
    await navigate(actor.page, uk.rewards, '/child/rewards');
    // Refresh server state explicitly; these two actors do not enable external push services.
    await actor.page.reload({ waitUntil: 'domcontentloaded' });
    await expect(actor.page.locator('.balance-chip strong')).toHaveText(String(family.points));
    const reward = rewardCard(actor.page, family.rewardTitle);
    const requested = await actionData<RewardRequest>(
      actor.page,
      `/rewards/${family.rewardId}/request`,
      () => reward.getByRole('button', { name: uk.requestReward, exact: true }).click(),
    );
    expect(requested.status).toBe('PENDING');
    expect(
      (await readApi<{ balance: number }>(actor.page, child.accessToken, '/points', origin))
        .balance,
    ).toBe(family.points);
    await navigate(page, uk.rewards, '/parent/rewards');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const review = rewardCard(page, family.rewardTitle).filter({
      has: page.getByRole('button', { name: uk.approve, exact: true }),
    });
    await expect(review).toHaveCount(1);
    const approved = await actionData<RewardRequest>(
      page,
      `/reward-requests/${requested.id}/approve`,
      () => review.getByRole('button', { name: uk.approve, exact: true }).click(),
    );
    expect(approved.status).toBe('APPROVED');
    expect(
      (await readApi<{ balance: number }>(actor.page, child.accessToken, '/points', origin))
        .balance,
    ).toBe(family.points - family.rewardCost);
    const issue = rewardCard(page, family.rewardTitle).filter({
      has: page.getByRole('button', { name: uk.issueReward, exact: true }),
    });
    const issued = await actionData<RewardRequest>(
      page,
      `/reward-requests/${requested.id}/issue`,
      () => issue.getByRole('button', { name: uk.issueReward, exact: true }).click(),
    );
    expect(issued.status).toBe('ISSUED');
    await expect(page.getByText(uk.rewardIssued, { exact: true })).toBeVisible();
    await actor.page.reload({ waitUntil: 'domcontentloaded' });
    await expect(actor.page.locator('.balance-chip strong')).toHaveText(
      String(family.points - family.rewardCost),
    );
    await expect(actor.page.getByText(uk.rewardStates.ISSUED, { exact: true })).toBeVisible();
    const transactions = await readApi<Transaction[]>(
      actor.page,
      child.accessToken,
      '/points/history',
      origin,
    );
    expect(transactions).toHaveLength(2);
    expect(
      transactions.filter((item) => item.type === 'TASK_REWARD').map((item) => item.amount),
    ).toEqual([family.points]);
    expect(
      transactions.filter((item) => item.type === 'REWARD_PURCHASE').map((item) => item.amount),
    ).toEqual([-family.rewardCost]);
    expect(transactions.reduce((sum, item) => sum + item.amount, 0)).toBe(15);
    expect(
      await readApi<Completion[]>(page, family.parent.accessToken, '/task-completions', origin),
    ).toHaveLength(1);
    const requests = await readApi<RewardRequest[]>(
      page,
      family.parent.accessToken,
      '/reward-requests',
      origin,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe('ISSUED');
    await test.step('role-specific routes cannot expose the other role’s controls', async () => {
      await actor.page.goto(`${origin}/parent/settings`);
      await expect(actor.page).toHaveURL(/\/child$/);
      await expect(actor.page.getByRole('form', { name: uk.changeEmail, exact: true })).toHaveCount(
        0,
      );
      await page.goto(`${origin}/child`);
      await expect(page).toHaveURL(/\/parent$/);
      await expect(page.getByRole('button', { name: uk.completeTask, exact: true })).toHaveCount(0);
    });
  } finally {
    await actor.context.close();
  }
});
