import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiAdvice, AiIntent, PublicUser } from '@kidquest/types';
import { QuestykCard, QuestykTaskHelp } from '../features/ai/QuestykLauncher';
import { aiUk } from '../features/ai/i18n';
import { resetApiSession, setAccessToken, serverConnection } from '../services/api';

const auth = vi.hoisted(() => ({ user: null as PublicUser | null }));
const connection = vi.hoisted(() => ({ connected: true }));
vi.mock('../app/providers/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../features/offline/OfflineProvider', () => ({ useOffline: () => connection }));
const child: PublicUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'child@example.test',
  firstName: 'Богдан',
  lastName: null,
  role: 'CHILD',
  familyId: '22222222-2222-4222-8222-222222222222',
};
const taskId = '33333333-3333-4333-8333-333333333333';
const childId = '44444444-4444-4444-8444-444444444444';
function advice(
  intent: AiIntent,
  source: 'LOCAL' | 'AI' = 'LOCAL',
  message = 'Почнімо з одного простого кроку.',
): AiAdvice {
  return {
    intent,
    message,
    tips: ['Підготуй усе потрібне.', 'За потреби звернися до батьків.'],
    source,
    reason: source === 'LOCAL' ? 'LOCAL_MODE' : null,
    generatedAt: '2026-10-23T10:00:00Z',
  };
}
function response(value: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status < 400
        ? { success: true, data: value }
        : { success: false, error: { code: 'TEMPORARY_ERROR', message: 'Спробуйте пізніше.' } },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}
function mockServer() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) =>
    response(advice(JSON.parse(String(options?.body)).intent)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
async function openCard() {
  await userEvent.setup().click(screen.getByRole('button', { name: aiUk.open }));
  return screen.findByRole('button', { name: aiUk.actions.GREETING });
}
function deferredResponse() {
  let resolve!: (value: Response) => void;
  return {
    promise: new Promise<Response>((done) => {
      resolve = done;
    }),
    resolve: (value: Response) => resolve(value),
  };
}
beforeAll(async () => {
  await import('../features/ai/QuestykPanel');
});
beforeEach(() => {
  resetApiSession();
  setAccessToken('test-session');
  auth.user = { ...child };
  connection.connected = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  localStorage.clear();
});
afterEach(() => {
  resetApiSession();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.unstubAllGlobals();
});

describe('Квестик explicit advice controls', () => {
  it('does not request advice on mount or open, then requests the chosen child intent and labels a local answer', async () => {
    const fetchMock = mockServer();
    render(<QuestykCard role="CHILD" childId={childId} />);
    expect(fetchMock).not.toHaveBeenCalled();
    const greeting = await openCard();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.setup().click(greeting);
    expect(await screen.findByText('Почнімо з одного простого кроку.')).toBeInTheDocument();
    expect(screen.getByText(aiUk.local)).toBeInTheDocument();
    expect(screen.queryByText(aiUk.generated)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/ai/advice');
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ intent: 'GREETING' });
    expect(screen.queryByRole('button', { name: aiUk.actions.PROGRESS })).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });

  it('shows an in-progress state and distinguishes an AI response from local advice', async () => {
    const fetchMock = mockServer();
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    render(<QuestykCard role="CHILD" />);
    await openCard();
    await userEvent.setup().click(screen.getByRole('button', { name: aiUk.actions.MOTIVATE }));
    expect(screen.getByText(aiUk.loading)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: aiUk.actions.PRAISE })).toBeDisabled();
    await act(async () => {
      pending.resolve(
        response(advice('MOTIVATE', 'AI', 'Спробуй почати з малого й обрати зручний темп.')),
      );
    });
    expect(await screen.findByText(aiUk.generated)).toBeInTheDocument();
    expect(screen.queryByText(aiUk.local)).not.toBeInTheDocument();
  });

  it('limits parent controls to progress and ideas and sends only the chosen child identifier', async () => {
    auth.user = { ...child, role: 'PARENT' };
    const fetchMock = mockServer();
    render(<QuestykCard role="PARENT" childId={childId} />);
    await userEvent.setup().click(screen.getByRole('button', { name: aiUk.open }));
    const progress = await screen.findByRole('button', { name: aiUk.actions.PROGRESS });
    expect(screen.queryByRole('button', { name: aiUk.actions.GREETING })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: aiUk.actions.QUEST_IDEAS })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: aiUk.actions.REWARD_IDEAS })).toBeInTheDocument();
    await userEvent.setup().click(progress);
    await screen.findByText(aiUk.local);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      intent: 'PROGRESS',
      childId,
    });
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith('/ai/advice'))).toBe(true);
  });

  it('offers a task-specific explanation without sending descriptions, photos or other client context', async () => {
    const fetchMock = mockServer();
    render(<QuestykTaskHelp taskId={taskId} />);
    await userEvent.setup().click(screen.getByRole('button', { name: aiUk.taskHelp }));
    const help = await screen.findByRole('button', { name: aiUk.actions.TASK_HELP });
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.setup().click(help);
    await screen.findByText(aiUk.local);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      intent: 'TASK_HELP',
      taskId,
    });
  });

  it('uses friendly static tips offline without making a request', async () => {
    const fetchMock = mockServer();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(<QuestykCard role="CHILD" />);
    const greeting = await openCard();
    expect(screen.getByText(aiUk.offline)).toBeInTheDocument();
    await userEvent.setup().click(greeting);
    expect(await screen.findByText(aiUk.offlineAdvice.GREETING.message)).toBeInTheDocument();
    expect(screen.getByText(aiUk.local)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses static tips when the API connection is down even while the browser network is online', async () => {
    const fetchMock = mockServer();
    connection.connected = false;
    render(<QuestykCard role="CHILD" />);
    await userEvent.setup().click(await openCard());
    expect(navigator.onLine).toBe(true);
    expect(await screen.findByText(aiUk.offlineAdvice.GREETING.message)).toBeInTheDocument();
    expect(screen.getByText(aiUk.offline)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes with Escape, returns focus to its trigger and clears the previous answer on reopening', async () => {
    const fetchMock = mockServer();
    render(<QuestykCard role="CHILD" />);
    await userEvent.setup().click(await openCard());
    await screen.findByText('Почнімо з одного простого кроку.');
    await userEvent.setup().keyboard('{Escape}');
    expect(screen.getByRole('button', { name: aiUk.open })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: aiUk.open })).toHaveFocus();
    await openCard();
    expect(screen.queryByText('Почнімо з одного простого кроку.')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('keeps a basic fallback available after an unavailable response and can retry the same intent', async () => {
    const fetchMock = mockServer();
    fetchMock.mockResolvedValueOnce(response(null, 503));
    render(<QuestykCard role="CHILD" />);
    const greeting = await openCard();
    await userEvent.setup().click(greeting);
    expect(await screen.findByRole('alert')).toHaveTextContent(aiUk.error);
    expect(screen.getByText(aiUk.offlineAdvice.GREETING.message)).toBeInTheDocument();
    expect(screen.getByText(aiUk.providerUnavailable)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: aiUk.retry }));
    expect(await screen.findByText('Почнімо з одного простого кроку.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)))).toEqual([
      { intent: 'GREETING' },
      { intent: 'GREETING' },
    ]);
  });

  it('aborts and hides a delayed response when the user identity changes', async () => {
    const fetchMock = mockServer();
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    const view = render(<QuestykCard role="CHILD" />);
    await userEvent.setup().click(await openCard());
    const signal = fetchMock.mock.calls[0]![1]?.signal;
    auth.user = { ...child, id: '55555555-5555-4555-8555-555555555555' };
    view.rerender(<QuestykCard role="CHILD" />);
    await waitFor(() => expect(signal?.aborted).toBe(true));
    await act(async () => {
      pending.resolve(response(advice('GREETING', 'AI', 'Попередня приватна відповідь')));
    });
    expect(screen.queryByText('Попередня приватна відповідь')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: aiUk.open })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await openCard();
    expect(screen.queryByText('Попередня приватна відповідь')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('closes the previous panel, aborts its request and clears its answer when another card is opened', async () => {
    const fetchMock = mockServer();
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    render(
      <>
        <QuestykCard role="CHILD" />
        <QuestykTaskHelp taskId={taskId} />
      </>,
    );
    await userEvent.setup().click(await openCard());
    const signal = fetchMock.mock.calls[0]![1]?.signal;
    await userEvent.setup().click(screen.getByRole('button', { name: aiUk.taskHelp }));
    await screen.findByRole('button', { name: aiUk.actions.TASK_HELP });
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: aiUk.open })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await act(async () => {
      pending.resolve(response(advice('GREETING', 'AI', 'Запізніла відповідь іншої картки')));
    });
    expect(screen.queryByText('Запізніла відповідь іншої картки')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not mark the API offline when closing the panel intentionally aborts its pending request', async () => {
    const fetchMock = mockServer();
    render(<QuestykCard role="CHILD" />);
    await userEvent.setup().click(await openCard());
    await screen.findByText('Почнімо з одного простого кроку.');
    expect(serverConnection()).toBe(true);
    let rejectedForAbort = false;
    fetchMock.mockImplementationOnce(
      (_input, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              rejectedForAbort = true;
              reject(new DOMException('Panel closed', 'AbortError'));
            },
            { once: true },
          );
        }),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: aiUk.actions.MOTIVATE }));
    expect(screen.getByText(aiUk.loading)).toBeInTheDocument();
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: aiUk.close }));
      await Promise.resolve();
    });
    expect(rejectedForAbort).toBe(true);
    expect(serverConnection()).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('clears and aborts task advice when the task context changes', async () => {
    const fetchMock = mockServer();
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    const view = render(<QuestykTaskHelp taskId={taskId} />);
    await userEvent.setup().click(screen.getByRole('button', { name: aiUk.taskHelp }));
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: aiUk.actions.TASK_HELP }));
    const signal = fetchMock.mock.calls[0]![1]?.signal;
    view.rerender(<QuestykTaskHelp taskId="66666666-6666-4666-8666-666666666666" />);
    await waitFor(() => expect(signal?.aborted).toBe(true));
    await act(async () => {
      pending.resolve(response(advice('TASK_HELP', 'AI', 'Порада для попереднього квесту')));
    });
    expect(screen.queryByText('Порада для попереднього квесту')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: aiUk.taskHelp })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
