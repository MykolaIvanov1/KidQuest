import { useEffect, useRef, useState } from 'react';
import type { AiAdvice, AiIntent, AiRequest } from '@kidquest/types';
import { useAuth } from '../../app/providers/AuthProvider';
import { api, isConnectionFailure } from '../../services/api';
import { useOnline } from '../../hooks/useOnline';
import { useOffline } from '../offline/OfflineProvider';
import { aiUk } from './i18n';

interface AdviceState {
  scope: string;
  advice: AiAdvice | null;
  intent: AiIntent | null;
  busy: boolean;
  error: string;
}
export function useAdvice({ taskId, childId }: { taskId?: string; childId?: string }) {
  const { user } = useAuth();
  const browserOnline = useOnline();
  const { connected } = useOffline();
  const online = browserOnline && connected !== false;
  const scope = JSON.stringify([user?.id, user?.familyId, user?.role, taskId, childId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<AdviceState | null>(null);
  useEffect(
    () => () => {
      revision.current += 1;
      controller.current?.abort();
    },
    [scope],
  );
  const local = (intent: AiIntent, unavailable = false): AiAdvice => ({
    intent,
    message: aiUk.offlineAdvice[intent].message,
    tips: [...aiUk.offlineAdvice[intent].tips],
    source: 'LOCAL',
    reason: unavailable ? 'PROVIDER_UNAVAILABLE' : 'LOCAL_MODE',
    generatedAt: new Date().toISOString(),
  });
  async function ask(intent: AiIntent) {
    if (!user) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const attempt = ++revision.current;
    const requestedScope = scope;
    const active = () =>
      !request.signal.aborted &&
      attempt === revision.current &&
      currentScope.current === requestedScope;
    setState({ scope, advice: null, intent, busy: true, error: '' });
    if (!online) {
      setState({ scope, advice: local(intent), intent, busy: false, error: '' });
      return;
    }
    const body: AiRequest = {
      intent,
      ...(taskId ? { taskId } : {}),
      ...(user.role === 'PARENT' && childId ? { childId } : {}),
    };
    try {
      const result = await api<AiAdvice>('/ai/advice', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: request.signal,
      });
      if (!active()) return;
      if (
        result.intent !== intent ||
        typeof result.message !== 'string' ||
        !Array.isArray(result.tips) ||
        result.tips.some((tip) => typeof tip !== 'string') ||
        !['LOCAL', 'AI'].includes(result.source)
      )
        throw new Error('INVALID_ADVICE');
      setState({ scope, advice: result, intent, busy: false, error: '' });
    } catch (error) {
      if (!active()) return;
      setState({
        scope,
        advice: isConnectionFailure(error) ? local(intent, true) : null,
        intent,
        busy: false,
        error: aiUk.error,
      });
    }
  }
  const visible = state?.scope === scope ? state : null;
  return {
    scope,
    online,
    advice: visible?.advice || null,
    intent: visible?.intent || null,
    busy: visible?.busy || false,
    error: visible?.error || '',
    ask,
  };
}
