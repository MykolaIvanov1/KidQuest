import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { LOCALE } from '@kidquest/shared';
import type { LoginJournalData, PublicUser } from '@kidquest/types';
import { CheckCircle2, History, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider';
import { api } from '../../services/api';
import { uk } from '../../lib/i18n';
import { Field } from '../../pages/auth/AuthPage';
import { QueryState } from '../workflows/common';

export function LoginJournal({ members, timeZone }: { members: PublicUser[]; timeZone: string }) {
  const { user } = useAuth();
  const [member, setMember] = useState('');
  const [success, setSuccess] = useState('');
  const journal = useInfiniteQuery({
    queryKey: ['login-journal', user?.id, member, success],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (member) params.set('userId', member);
      if (success) params.set('success', success);
      if (pageParam) params.set('cursor', pageParam);
      return api<LoginJournalData>(`/account/login-journal?${params}`);
    },
    getNextPageParam: (page) => page.nextCursor || undefined,
  });
  const items = journal.data?.pages.flatMap((page) => page.items) || [];
  return (
    <section className="panel login-journal" aria-labelledby="login-journal-heading">
      <h2 id="login-journal-heading">
        <History size={22} />
        {uk.loginJournal}
      </h2>
      <p className="muted">{uk.loginJournalLead}</p>
      <div className="form-row journal-filters">
        <Field label={uk.journalAccount}>
          <select value={member} onChange={(event) => setMember(event.target.value)}>
            <option value="">{uk.journalAllMembers}</option>
            {members.map((item) => (
              <option value={item.id} key={item.id}>
                {item.firstName} ({item.email})
              </option>
            ))}
          </select>
        </Field>
        <Field label={uk.journalResult}>
          <select value={success} onChange={(event) => setSuccess(event.target.value)}>
            <option value="">{uk.journalAllResults}</option>
            <option value="true">{uk.journalSuccess}</option>
            <option value="false">{uk.journalFailure}</option>
          </select>
        </Field>
      </div>
      <QueryState pending={journal.isPending} error={journal.error} retry={journal.refetch} />
      {journal.data && items.length === 0 && <p className="journal-empty">{uk.journalEmpty}</p>}
      <ol className="journal-list">
        {items.map((item) => (
          <li key={item.id} className="journal-entry">
            <div className={`journal-result ${item.success ? 'successful' : 'failed'}`}>
              {item.success ? <CheckCircle2 size={20} /> : <ShieldAlert size={20} />}
              <strong>{item.success ? uk.journalSuccess : uk.journalFailure}</strong>
            </div>
            <strong className="journal-user">
              {[item.user.firstName, item.user.lastName].filter(Boolean).join(' ')}
            </strong>
            <span className="journal-email">{item.user.email}</span>
            <dl>
              <div>
                <dt>{uk.journalDate}</dt>
                <dd>
                  <time dateTime={item.loginAt}>
                    {new Intl.DateTimeFormat(LOCALE, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone,
                    }).format(new Date(item.loginAt))}
                  </time>
                </dd>
              </div>
              <div>
                <dt>{uk.journalDevice}</dt>
                <dd>{item.device || uk.journalUnknown}</dd>
              </div>
              <div>
                <dt>{uk.journalIp}</dt>
                <dd>{item.ipAddress || uk.journalUnknown}</dd>
              </div>
            </dl>
            {item.userAgent && (
              <details className="journal-agent">
                <summary>{uk.journalBrowser}</summary>
                <p>{item.userAgent}</p>
              </details>
            )}
          </li>
        ))}
      </ol>
      {journal.hasNextPage && (
        <button
          type="button"
          className="button tonal"
          disabled={journal.isFetchingNextPage}
          onClick={() => void journal.fetchNextPage()}
        >
          {journal.isFetchingNextPage ? uk.wait : uk.journalMore}
        </button>
      )}
    </section>
  );
}
