import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bot,
  CalendarDays,
  Check,
  ClipboardCheck,
  Flame,
  Gift,
  ListChecks,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Users,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { DashboardData, PublicUser } from '@kidquest/types';
import { useAuth } from '../app/providers/AuthProvider';
import { AppShell } from '../components/layout/AppShell';
import { MemberForm } from '../features/auth/MemberForm';
import { api, isConnectionFailure } from '../services/api';
import { uk } from '../lib/i18n';
import { LOCALE } from '@kidquest/shared';
import { TaskList } from '../features/quests/TaskList';
import { TaskReviews, RewardRequests } from '../features/workflows/Reviews';
import { PointsHistory } from '../features/points/PointsHistory';
import { QuestykCard } from '../features/ai/QuestykLauncher';

export default function DashboardPage() {
  const { user } = useAuth();
  const parent = user?.role === 'PARENT';
  const query = useQuery({
    queryKey: ['dashboard', user?.id],
    queryFn: () => api<DashboardData>('/statistics'),
  });
  const members = useQuery({
    queryKey: ['members', user?.familyId],
    queryFn: () => api<PublicUser[]>('/family/members'),
    enabled: parent,
  });
  const data = query.data;
  const date = new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: data?.family.timeZone || 'Europe/Kyiv',
  }).format(new Date());
  return (
    <AppShell>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">{parent ? uk.parentEyebrow : uk.childEyebrow}</p>
          <h1>
            {uk.greeting(user?.firstName || '')}
            <span className="greeting-spark" aria-hidden="true">
              ✦
            </span>
          </h1>
          <p className="muted">{parent ? uk.parentIntro : uk.childIntro}</p>
        </div>
        <span className="date-chip">
          <CalendarDays size={17} />
          {date}
        </span>
      </div>
      {query.isPending && (
        <div className="loading-card" role="status">
          <span className="spinner" />
          {uk.loading}
        </div>
      )}
      {query.isError && (parent || data === undefined || !isConnectionFailure(query.error)) && (
        <div className="error-card" role="alert">
          <h2>{uk.errorTitle}</h2>
          <p>{query.error.message}</p>
          <button className="button tonal" onClick={() => void query.refetch()}>
            {uk.retry}
          </button>
        </div>
      )}
      {data && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <section className="welcome-banner">
            <div className="banner-content">
              <span className="banner-kicker">
                <Sparkles size={15} />
                {data.family.name}
              </span>
              <h2>{parent ? uk.parentGreeting : uk.tagline}</h2>
              <p>
                {parent
                  ? data.child
                    ? uk.childOverview(data.child.firstName)
                    : uk.familyLead
                  : uk.questikHint}
              </p>
            </div>
            <div className="banner-robot" aria-hidden="true">
              <span className="banner-star">✦</span>
              <Bot size={86} strokeWidth={1.3} />
              <span className="banner-small-star">✧</span>
            </div>
          </section>
          <section className="stat-grid" aria-label={uk.allFamily}>
            <Stat
              icon={<Star size={23} />}
              tone="gold"
              label={uk.balance}
              value={data.balance.toLocaleString(LOCALE)}
              suffix={uk.points}
            />
            {parent ? (
              <>
                <Stat
                  icon={<ListChecks size={23} />}
                  tone="green"
                  label={uk.activeTasks}
                  value={data.counts.activeTasks}
                />
                <Stat
                  icon={<ClipboardCheck size={23} />}
                  tone="purple"
                  label={uk.pending}
                  value={data.counts.pendingCompletions + data.counts.pendingRewards}
                />
              </>
            ) : (
              <>
                <Stat
                  icon={<Flame size={23} />}
                  tone="peach"
                  label={uk.streak}
                  value={data.streak ?? 0}
                />
                <Stat
                  icon={<Check size={23} />}
                  tone="green"
                  label={uk.dayProgress}
                  value={`${data.today.total ? Math.round((data.today.approved / data.today.total) * 100) : 0}%`}
                />
              </>
            )}
          </section>
          <div className="dashboard-columns">
            <div className="main-column">
              {parent && (
                <>
                  <TaskReviews />
                  <RewardRequests parent />
                </>
              )}
              <section className="panel task-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      <ListChecks size={20} />
                      {uk.dailyTasks}
                    </h2>
                    <p>{uk.dailyLead}</p>
                  </div>
                  <span className="count-pill">{data.tasks.length}</span>
                </div>
                {!parent ? (
                  <TaskList />
                ) : data.tasks.length ? (
                  <ul className="task-list">
                    {data.tasks.map((task) => (
                      <li className="task-row" key={task.id}>
                        <span className="task-icon">
                          <ListChecks size={23} />
                        </span>
                        <div>
                          <h3>{task.title}</h3>
                          <p>{task.description || task.category}</p>
                          {task.photoRequired && <small>{uk.photoRequired}</small>}
                        </div>
                        <span className="points-pill">
                          <Star size={14} />+{task.points}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty-state">
                    <span className="empty-art">
                      <ListChecks size={36} />
                      <span className="empty-mini">
                        <Plus size={14} />
                      </span>
                    </span>
                    <h3>{uk.noTasks}</h3>
                    <p>{parent ? uk.noTasksParent : uk.noTasksChild}</p>
                  </div>
                )}
                {!parent && (
                  <div className="panel-note">
                    <ShieldCheck size={17} />
                    {uk.aboutPoints}
                  </div>
                )}
                {parent && (
                  <Link className="button tonal panel-link" to="/parent/quests">
                    {uk.manageQuests}
                  </Link>
                )}
              </section>
              {!parent && <PointsHistory />}
              {parent && (
                <section className="panel family-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        <Users size={20} />
                        {uk.family}
                      </h2>
                      <p>{uk.familyLead}</p>
                    </div>
                  </div>
                  {members.isPending && <p role="status">{uk.loading}</p>}
                  {members.isError && (
                    <p role="alert" className="form-error">
                      {members.error.message}
                      <button className="text-button" onClick={() => void members.refetch()}>
                        {uk.retry}
                      </button>
                    </p>
                  )}
                  {members.data && (
                    <ul className="members-list">
                      {members.data.map((member) => (
                        <li key={member.id}>
                          <span
                            className={`avatar ${member.role === 'CHILD' ? 'child-avatar' : ''}`}
                          >
                            {member.firstName.slice(0, 1)}
                          </span>
                          <div>
                            <strong>{member.firstName}</strong>
                            <small>{member.email}</small>
                          </div>
                          <span className="role-badge">
                            {member.role === 'PARENT' ? uk.parent : uk.child}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <MemberForm />
                </section>
              )}
            </div>
            <div className="side-column">
              <QuestykCard
                role={parent ? 'PARENT' : 'CHILD'}
                childId={parent ? data.child?.id : undefined}
              />
              <section className="panel reward-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      <Gift size={20} />
                      {uk.rewards}
                    </h2>
                    <p>{uk.rewardsLead}</p>
                  </div>
                </div>
                {data.rewards.length ? (
                  <ul className="reward-list">
                    {data.rewards.map((reward) => (
                      <li key={reward.id}>
                        <span className="reward-icon">
                          <Gift size={25} />
                        </span>
                        <div>
                          <h3>{reward.title}</h3>
                          <span className="muted">
                            {reward.cost} {uk.points}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty-state compact">
                    <span className="empty-art gift-art">
                      <Gift size={32} />
                    </span>
                    <h3>{uk.noRewards}</h3>
                    <p>{uk.noRewardsLead}</p>
                  </div>
                )}
                <Link
                  className="button tonal panel-link"
                  to={parent ? '/parent/rewards' : '/child/rewards'}
                >
                  {parent ? uk.manageRewards : uk.requestReward}
                </Link>
              </section>
              <section className="achievement-card">
                <span className="achievement-icon">
                  <Trophy size={27} />
                </span>
                <p className="section-label">{uk.nextAchievement}</p>
                {data.gamification?.nextAchievement ? (
                  <>
                    <h3>{data.gamification.nextAchievement.title}</h3>
                    <p>{data.gamification.nextAchievement.description}</p>
                    <div className="achievement-meter">
                      <progress
                        aria-label={data.gamification.nextAchievement.title}
                        max={data.gamification.nextAchievement.target}
                        value={Math.min(
                          data.gamification.nextAchievement.progress,
                          data.gamification.nextAchievement.target,
                        )}
                      />
                      <strong>
                        {uk.achievementProgress(
                          Math.min(
                            data.gamification.nextAchievement.progress,
                            data.gamification.nextAchievement.target,
                          ),
                          data.gamification.nextAchievement.target,
                        )}
                      </strong>
                    </div>
                  </>
                ) : data.gamification?.childId ? (
                  <>
                    <h3>{uk.allAchievementsEarned}</h3>
                    <p>{uk.allAchievementsLead}</p>
                  </>
                ) : (
                  <p>{data.child ? uk.nextAchievementLead : uk.noChildProgress}</p>
                )}
                {data.child && (
                  <Link
                    className="text-button achievement-link"
                    to={parent ? '/parent/achievements' : '/child/achievements'}
                  >
                    {uk.viewAchievements}
                  </Link>
                )}
              </section>
              {!parent && (
                <p className="subtle-note">
                  <Flame size={16} />
                  {uk.streakHint}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AppShell>
  );
}
function Stat({
  icon,
  label,
  value,
  suffix,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  suffix?: string;
  tone: string;
}) {
  return (
    <div className="stat-card">
      <span className={`stat-icon ${tone}`}>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>
          {value}
          <small>{suffix}</small>
        </strong>
      </div>
    </div>
  );
}
