import { useQuery } from '@tanstack/react-query';
import type { AchievementsData } from '@kidquest/types';
import { ArrowLeft, Flame, ListChecks, Star, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../app/providers/AuthProvider';
import { AchievementCard } from '../features/gamification/AchievementCard';
import { QueryState } from '../features/workflows/common';
import { api } from '../services/api';
import { uk } from '../lib/i18n';

export default function AchievementsPage() {
  const { user } = useAuth();
  const parent = user?.role === 'PARENT';
  const query = useQuery({
    queryKey: ['achievements', user?.id],
    queryFn: () => api<AchievementsData>('/achievements'),
  });
  const data = query.data;
  return (
    <AppShell>
      <div className="workflow-page-heading">
        <div>
          <p className="eyebrow">{parent ? uk.parentEyebrow : uk.childEyebrow}</p>
          <h1>{uk.achievements}</h1>
          <p className="muted">{uk.achievementsLead}</p>
        </div>
        <Link className="button tonal" to={parent ? '/parent/statistics' : '/child/calendar'}>
          <ArrowLeft size={18} />
          {parent ? uk.statistics : uk.calendar}
        </Link>
      </div>
      <QueryState
        hasData={!parent && query.data !== undefined}
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
      {data &&
        (!data.child ? (
          <div className="panel empty-state">
            <Trophy size={32} />
            <p>{uk.noChildProgress}</p>
          </div>
        ) : (
          <>
            {parent && (
              <p className="gamification-child">{uk.childOverview(data.child.firstName)}</p>
            )}
            <dl
              className="gamification-metrics achievement-metrics"
              aria-label={uk.lifetimeSummary}
            >
              <div>
                <dt>
                  <Flame size={18} />
                  {uk.streak}
                </dt>
                <dd>{data.summary.streak}</dd>
              </div>
              <div>
                <dt>
                  <ListChecks size={18} />
                  {uk.lifetimeApprovedTasks}
                </dt>
                <dd>{data.summary.approvedTasks}</dd>
              </div>
              <div>
                <dt>
                  <Star size={18} />
                  {uk.lifetimeEarnedPoints}
                </dt>
                <dd>{data.summary.earnedPoints}</dd>
              </div>
            </dl>
            <p className="gamification-note">{uk.achievementsRules}</p>
            {data.achievements.length ? (
              <section className="achievement-grid" aria-label={uk.achievementsOverview}>
                {data.achievements.map((achievement) => (
                  <AchievementCard
                    achievement={achievement}
                    timeZone={data.summary.timeZone}
                    key={achievement.id}
                  />
                ))}
              </section>
            ) : (
              <div className="panel empty-state">
                <h2>{uk.noAchievements}</h2>
                <p>{uk.noAchievementsLead}</p>
              </div>
            )}
          </>
        ))}
    </AppShell>
  );
}
