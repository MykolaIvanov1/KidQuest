import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { uk } from '../../lib/i18n';

export function useOperationId() {
  const operation = useRef(crypto.randomUUID());
  return {
    current: () => operation.current,
    renew: () => {
      operation.current = crypto.randomUUID();
    },
  };
}

export function useRefreshFamilyData() {
  const client = useQueryClient();
  return async () => {
    await Promise.all(
      [
        'tasks',
        'categories',
        'dashboard',
        'completions',
        'rewards',
        'reward-requests',
        'points',
        'point-history',
      ].map((key) => client.invalidateQueries({ queryKey: [key] })),
    );
  };
}

export function QueryState({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: Error | null;
  retry: () => unknown;
}) {
  if (pending)
    return (
      <p className="workflow-loading" role="status">
        <span className="spinner" />
        {uk.loading}
      </p>
    );
  if (error)
    return (
      <div className="form-error" role="alert">
        <AlertCircle size={18} />
        <span>{error.message}</span>
        <button type="button" className="text-button" onClick={() => void retry()}>
          {uk.retry}
        </button>
      </div>
    );
  return null;
}

export function Feedback({ error, success }: { error?: Error | null; success?: string }) {
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      )}
      {success && (
        <p className="success-message" role="status">
          <CheckCircle2 size={18} />
          {success}
        </p>
      )}
    </>
  );
}

export function DeleteAction({ pending, remove }: { pending: boolean; remove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <div className="delete-confirm">
      <p>{uk.removeHint}</p>
      <button type="button" className="button danger" disabled={pending} onClick={remove}>
        {pending ? uk.wait : uk.confirmRemove}
      </button>
      <button type="button" className="text-button" onClick={() => setConfirming(false)}>
        {uk.cancel}
      </button>
    </div>
  ) : (
    <button type="button" className="text-button danger-text" onClick={() => setConfirming(true)}>
      {uk.remove}
    </button>
  );
}
