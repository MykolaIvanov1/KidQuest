import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellRing, BellOff } from 'lucide-react';
import type { NotificationStatusData } from '@kidquest/types';
import { useAuth } from '../../app/providers/AuthProvider';
import { api } from '../../services/api';
import { uk } from '../../lib/i18n';
import { disablePush, enablePush, pushState, type PushState } from './push';

export function PushSettings() {
  const { user } = useAuth();
  const [state, setState] = useState<PushState>(pushState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => setState(pushState());
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const status = useQuery({
    queryKey: ['notification-status', user?.id],
    queryFn: () => api<NotificationStatusData>('/notifications/status'),
  });
  const missing = state === 'missing' || status.data?.pushConfigured === false;
  const message = missing ? uk.pushMissing : uk.pushStates[state];
  return (
    <section className="panel push-settings" aria-labelledby="push-heading">
      <div className="push-setting-copy">
        <span className="notification-icon">
          <BellRing size={23} />
        </span>
        <div>
          <h2 id="push-heading">{uk.pushHeading}</h2>
          <p className="muted">{message}</p>
        </div>
      </div>
      {(state === 'active' || (!missing && state === 'off')) && (
        <button
          type="button"
          className="button tonal"
          disabled={busy || (state === 'off' && !status.data?.pushConfigured)}
          onClick={async () => {
            if (!user) return;
            setBusy(true);
            setError('');
            try {
              if (state === 'active') {
                await disablePush();
                setState('off');
              } else setState(await enablePush(user.id));
            } catch {
              setError(uk.pushError);
            } finally {
              setBusy(false);
            }
          }}
        >
          {state === 'active' ? <BellOff size={18} /> : <BellRing size={18} />}
          {busy ? uk.wait : state === 'active' ? uk.pushDisable : uk.pushEnable}
        </button>
      )}
      {status.error && (
        <p className="form-error" role="alert">
          {uk.pushStatusError}
          <button type="button" className="text-button" onClick={() => void status.refetch()}>
            {uk.retry}
          </button>
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
