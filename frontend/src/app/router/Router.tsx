import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { Role } from '@kidquest/types';
import { useAuth } from '../providers/AuthProvider';
import { uk } from '../../lib/i18n';
const AuthPage = lazy(() => import('../../pages/auth/AuthPage'));
const DashboardPage = lazy(() => import('../../pages/DashboardPage'));
const QuestsPage = lazy(() => import('../../pages/QuestsPage'));
const RewardsPage = lazy(() => import('../../pages/RewardsPage'));

export function Router() {
  const { user, loading } = useAuth();
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
    page?: 'dashboard' | 'quests' | 'rewards';
  }) {
    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== role) return <Navigate to={home} replace />;
    return page === 'quests' ? (
      <QuestsPage />
    ) : page === 'rewards' ? (
      <RewardsPage />
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
        <Route path="/parent/rewards" element={<Protected role="PARENT" page="rewards" />} />
        <Route path="/child/adventure" element={<Protected role="CHILD" page="quests" />} />
        <Route path="/child/rewards" element={<Protected role="CHILD" page="rewards" />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </Suspense>
  );
}
