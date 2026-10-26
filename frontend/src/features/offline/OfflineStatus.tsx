import { useState } from 'react';
import { CloudCheck, CloudOff, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useOffline } from './OfflineProvider';
import { useOnline } from '../../hooks/useOnline';
import { uk } from '../../lib/i18n';
import '../../styles/offline.css';

export function OfflineStatus() {
  const {
    ready,
    available,
    cachedAt,
    timeZone,
    pending,
    syncing,
    retry,
    discard,
    sync,
    shellState,
    connected,
  } = useOffline();
  const browserOnline = useOnline();
  const online = browserOnline && connected !== false;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!ready) return null;
  const failed = pending.filter((item) => item.status === 'FAILED');
  const waiting = pending.filter((item) => item.status !== 'FAILED');
  const heading = !available
    ? uk.offlineStorageUnavailable
    : syncing
      ? uk.offlineSyncing
      : waiting.length
        ? uk.offlineWaiting(waiting.length)
        : failed.length
          ? uk.offlineAttention(failed.length)
          : online
            ? cachedAt
              ? uk.offlineReady
              : uk.offlineConnected
            : uk.offlineChild;
  async function run(operationId: string, action: () => Promise<void>) {
    setError('');
    setWorking(operationId);
    try {
      await action();
      setConfirming(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : uk.genericError);
    } finally {
      setWorking(null);
    }
  }
  return (
    <section className="offline-status" aria-label={uk.offlineStatus}>
      <div className="offline-status-heading" role="status" aria-live="polite">
        <span className="offline-status-icon" aria-hidden="true">
          {syncing ? (
            <RefreshCw size={21} className="offline-spin" />
          ) : online ? (
            <CloudCheck size={21} />
          ) : (
            <CloudOff size={21} />
          )}
        </span>
        <div>
          <strong>{heading}</strong>
          <p>
            {available
              ? !online && !cachedAt
                ? uk.offlineNoCache
                : uk.offlineQueueHint
              : uk.offlineStorageHint}
          </p>
          {cachedAt && !online && (
            <small>
              {uk.offlineSavedAt(
                new Intl.DateTimeFormat('uk-UA', {
                  timeZone,
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(cachedAt)),
              )}
            </small>
          )}
        </div>
        {online && available && waiting.length > 0 && (
          <button
            type="button"
            className="text-button"
            disabled={syncing || working !== null}
            onClick={() => void run('sync', sync)}
          >
            <Send size={17} />
            {uk.offlineSyncNow}
          </button>
        )}
      </div>
      {shellState === 'UNAVAILABLE' && (
        <p className={'offline-shell-hint'}>{uk.offlineShellUnavailable}</p>
      )}
      {failed.length > 0 && (
        <ul className="offline-errors" aria-label={uk.offlineNeedAttention}>
          {failed.map((item) => (
            <li key={item.operationId}>
              <strong>{item.taskTitle}</strong>
              <p>{item.errorMessage || uk.offlineSendError}</p>
              <small>{uk.offlinePhotosKept}</small>
              {confirming === item.operationId ? (
                <div className="offline-discard-confirm">
                  <p>{uk.offlineDiscardHint}</p>
                  <div className="offline-actions">
                    <button
                      type="button"
                      className="button danger"
                      disabled={working !== null}
                      onClick={() => void run(item.operationId, () => discard(item.operationId))}
                    >
                      {uk.offlineConfirmDiscard}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={working !== null}
                      onClick={() => setConfirming(null)}
                    >
                      {uk.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="offline-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={!online || working !== null}
                    onClick={() => void run(item.operationId, () => retry(item.operationId))}
                  >
                    <RefreshCw size={16} />
                    {uk.retry}
                  </button>
                  <button
                    type="button"
                    className="text-button danger-text"
                    disabled={working !== null}
                    onClick={() => setConfirming(item.operationId)}
                  >
                    <Trash2 size={16} />
                    {uk.offlineDiscard}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
