import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProgressData } from '@kidquest/types';
import { ChevronLeft, ChevronRight, Flame, ListChecks, Star, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../app/providers/AuthProvider';
import { ProgressCalendar } from '../features/gamification/ProgressCalendar';
import { ProgressChart } from '../features/gamification/ProgressChart';
import { formatCalendarDate, moveMonth } from '../features/gamification/format';
import { QueryState } from '../features/workflows/common';
import { api } from '../services/api';
import { uk } from '../lib/i18n';

export default function ProgressPage() {
  const { user } = useAuth();
  const parent = user?.role === 'PARENT';
  const [month, setMonth] = useState('');
  const query = useQuery({
    queryKey: ['progress', user?.id, month],
    queryFn: () => api<ProgressData>(`/statistics/progress${month ? `?month=${month}` : ''}`),
  });
  const data = query.data;
  const selectedMonth = month || data?.month || '';
  return (
    <AppShell>
      <div className="workflow-page-heading">
        <div>
          <p className="eyebrow">{parent ? uk.parentEyebrow : uk.childEyebrow}</p>
          <h1>{parent ? uk.statistics : uk.calendar}</h1>
          <p className="muted">{uk.progressLead}</p>
        </div>
        <Link className="button tonal" to={parent ? '/parent/achievements' : '/child/achievements'}>
          <Trophy size={18} />
          {uk.achievements}
        </Link>
      </div>
      {data?.child && (
        <div className="history-toolbar">
          <div>
            <strong>{uk.childOverview(data.child.firstName)}</strong>
            <p className="muted">{uk.familyTimeZone(data.timeZone)}</p>
          </div>
          <div className="month-picker">
            <button
              type="button"
              className="icon-button"
              aria-label={uk.previousMonth}
              onClick={() => setMonth(moveMonth(selectedMonth, -1))}
            >
              <ChevronLeft size={20} />
            </button>
            <label className="field">
              <span>{uk.progressMonth}</span>
              <input
                type="month"
                value={selectedMonth}
                max={data.today.slice(0, 7)}
                onChange={(event) => {
                  const next = event.target.value;
                  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(next) && next <= data.today.slice(0, 7))
                    setMonth(next);
                }}
              />
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label={uk.nextMonth}
              disabled={selectedMonth >= data.today.slice(0, 7)}
              onClick={() => setMonth(moveMonth(selectedMonth, 1))}
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}
      <QueryState
        hasData={!parent && query.data !== undefined}
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
      {data &&
        (!data.child ? (
          <div className="panel empty-state">
            <ListChecks size={32} />
            <p>{uk.noChildProgress}</p>
          </div>
        ) : (
          <>
            <dl className="gamification-metrics" aria-label={uk.monthSummary}>
              <div>
                <dt>
                  <ListChecks size={18} />
                  {uk.approvedTasks}
                </dt>
                <dd>{data.summary.approved}</dd>
              </div>
              <div>
                <dt>
                  <Star size={18} />
                  {uk.earnedPoints}
                </dt>
                <dd>{data.summary.earnedPoints}</dd>
              </div>
              <div>
                <dt>
                  <Flame size={18} />
                  {uk.successfulDays}
                </dt>
                <dd>{data.summary.successfulDays}</dd>
              </div>
              <div>
                <dt>
                  <Trophy size={18} />
                  {uk.bestStreak}
                </dt>
                <dd>{data.bestStreak}</dd>
              </div>
            </dl>
            <div className="history-columns">
              <ProgressCalendar key={data.month} data={data} />
              <div className="history-side">
                <ProgressChart data={data} />
                <section className="panel streak-summary">
                  <h2>
                    <Flame size={20} />
                    {uk.streak}
                  </h2>
                  <strong className="streak-value">{data.streak}</strong>
                  <p className="muted">{uk.streakHint}</p>
                  <dl className="lifetime-metrics" aria-label={uk.lifetimeSummary}>
                    <div>
                      <dt>{uk.lifetimeApprovedTasks}</dt>
                      <dd>{data.lifetimeApprovedTasks}</dd>
                    </div>
                    <div>
                      <dt>{uk.lifetimeEarnedPoints}</dt>
                      <dd>{data.lifetimeEarnedPoints}</dd>
                    </div>
                  </dl>
                  {data.trackingFrom && (
                    <p className="tracking-note">
                      {uk.trackingFrom(formatCalendarDate(data.trackingFrom))}
                    </p>
                  )}
                </section>
              </div>
            </div>
          </>
        ))}
    </AppShell>
  );
}
