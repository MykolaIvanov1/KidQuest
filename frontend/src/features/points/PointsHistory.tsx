import { useQuery } from '@tanstack/react-query';
import type { PointTransactionDto } from '@kidquest/types';
import { History } from 'lucide-react';
import { api } from '../../services/api';
import { uk } from '../../lib/i18n';
import { QueryState } from '../workflows/common';

export function PointsHistory() {
  const query = useQuery({
    queryKey: ['point-history'],
    queryFn: () => api<PointTransactionDto[]>('/points/history'),
  });
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>
            <History size={20} />
            {uk.history}
          </h2>
        </div>
      </div>
      <div className="review-content">
        <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
        {query.data && !query.data.length && (
          <p className="empty-state compact muted">{uk.noPointHistory}</p>
        )}
        <ul className="point-history">
          {query.data?.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{uk.transactionTypes[entry.type]}</strong>
                {entry.description && <p>{entry.description}</p>}
                <small>
                  {new Intl.DateTimeFormat('uk-UA', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(entry.createdAt))}
                </small>
              </div>
              <span className={entry.amount > 0 ? 'positive-amount' : 'negative-amount'}>
                {entry.amount > 0 ? '+' : ''}
                {entry.amount}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
