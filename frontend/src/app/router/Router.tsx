import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '@kidquest/types';
import { useAuth } from '../providers/AuthProvider';
import { uk } from '../../lib/i18n';
const AuthPage = lazy(() => import('../../pages/auth/AuthPage'));
const DashboardPage = lazy(() => import('../../pages/DashboardPage'));
const QuestsPage = lazy(() => import('../../pages/QuestsPage'));
const RewardsPage = lazy(() => import('../../pages/RewardsPage'));
const AchievementsPage = lazy(() => import('../../pages/AchievementsPage'));
const ProgressPage = lazy(() => import('../../pages/ProgressPage'));
const NotificationsPage = lazy(() => import('../../pages/NotificationsPage'));
const AccountPage = lazy(() => import('../../pages/AccountPage'));

export function Router() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  const home = user ? (user.role === 'PARENT' ? '/parent' : '/child') : '/login';
  if (loading)
    return (
      <div className="app-loading" role="status">
        <span className="spinner" />
        {uk.loading}
      </div>
    );
  function Protected({
    role,
    page = 'dashboard',
  }: {
    role: Role;
    page?:
      | 'dashboard'
      | 'quests'
      | 'rewards'
      | 'achievements'
      | 'progress'
      | 'notifications'
      | 'account';
  }) {
    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== role) return <Navigate to={home} replace />;
    return page === 'account' ? (
      <AccountPage />
    ) : page === 'quests' ? (
      <QuestsPage />
    ) : page === 'rewards' ? (
      <RewardsPage />
    ) : page === 'achievements' ? (
      <AchievementsPage />
    ) : page === 'notifications' ? (
      <NotificationsPage />
    ) : page === 'progress' ? (
      <ProgressPage />
    ) : (
      <DashboardPage />
    );
  }
  return (
    <Suspense
      fallback={
        <div className="app-loading" role="status">
          {uk.loading}
        </div>
      }
    >
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage />} />
        <Route path="/parent" element={<Protected role="PARENT" />} />
        <Route path="/child" element={<Protected role="CHILD" />} />
        <Route path="/parent/quests" element={<Protected role="PARENT" page="quests" />} />
        <Route
          path="/parent/notifications"
          element={<Protected role="PARENT" page="notifications" />}
        />
        <Route
          path="/child/notifications"
          element={<Protected role="CHILD" page="notifications" />}
        />
        <Route path="/parent/rewards" element={<Protected role="PARENT" page="rewards" />} />
        <Route path="/parent/statistics" element={<Protected role="PARENT" page="progress" />} />
        <Route
          path="/parent/achievements"
          element={<Protected role="PARENT" page="achievements" />}
        />
        <Route path="/child/adventure" element={<Protected role="CHILD" page="quests" />} />
        <Route path="/child/rewards" element={<Protected role="CHILD" page="rewards" />} />
        <Route
          path="/child/achievements"
          element={<Protected role="CHILD" page="achievements" />}
        />
        <Route path="/child/calendar" element={<Protected role="CHILD" page="progress" />} />
        <Route path="/child/profile" element={<Protected role="CHILD" page="account" />} />
        <Route path="/parent/settings" element={<Protected role="PARENT" page="account" />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </Suspense>
  );
}
