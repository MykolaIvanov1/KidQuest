import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  CircleHelp,
  ChartNoAxesCombined,
  Gift,
  House,
  ListChecks,
  LogOut,
  Map,
  Settings,
  ShieldCheck,
  Trophy,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Brand } from '../ui/Brand';
import { ThemeButton } from '../ui/ThemeButton';
import { useAuth } from '../../app/providers/AuthProvider';
import { useOnline } from '../../hooks/useOnline';
import { uk } from '../../lib/i18n';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import { OfflineStatus } from '../../features/offline/OfflineStatus';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const online = useOnline();
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const parent = user?.role === 'PARENT';
  const location = useLocation();
  const navigation = [
    { to: parent ? '/parent' : '/child', label: parent ? uk.parentPanel : uk.home, icon: House },
    {
      to: parent ? '/parent/quests' : '/child/adventure',
      label: parent ? uk.quests : uk.adventure,
      icon: parent ? ListChecks : Map,
    },
    { to: parent ? '/parent/rewards' : '/child/rewards', label: uk.rewards, icon: Gift },
    ...(parent
      ? [
          { to: '/parent/statistics', label: uk.statistics, icon: ChartNoAxesCombined },
          { to: '/parent/settings', label: uk.settings, icon: Settings },
        ]
      : [
          { to: '/child/achievements', label: uk.achievements, icon: Trophy },
          { to: '/child/profile', label: uk.profile, icon: UserRound },
        ]),
  ];
  const current =
    navigation.find((item) => item.to === location.pathname)?.label ||
    (location.pathname.endsWith('/notifications')
      ? uk.notifications
      : location.pathname === '/parent/achievements'
        ? uk.achievements
        : location.pathname === '/child/calendar'
          ? uk.calendar
          : navigation[0]!.label);
  const navLinks = navigation.map(({ to, label, icon: Icon }) => (
    <NavLink
      key={to}
      to={to}
      end
      className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
    >
      <Icon size={21} />
      <span>{label}</span>
    </NavLink>
  ));
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="sidebar-brand" to="/">
          <Brand />
        </Link>
        <span className="sidebar-label">
          {user?.role === 'PARENT' ? uk.familyAccount : uk.childEyebrow}
        </span>
        <nav aria-label={uk.home}>{navLinks}</nav>
        <div className="sidebar-tip">
          <ShieldCheck size={25} />
          <strong>{uk.secure}</strong>
          <p>{uk.aboutPoints}</p>
        </div>
        <div className="sidebar-bottom">
          <CircleHelp size={17} />
          <span>{uk.footer}</span>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <Link className="mobile-brand" to="/">
            <Brand />
          </Link>
          <span className="desktop-label">{current}</span>
          <div className="topbar-actions">
            <NotificationBell />
            <ThemeButton />
            <span className="topbar-divider" />
            <div className="user-chip">
              <span className="avatar">{user?.firstName.slice(0, 1)}</span>
              <span className="user-details">
                <strong>{user?.firstName}</strong>
                <small>{user?.role === 'PARENT' ? uk.parent : uk.child}</small>
              </span>
            </div>
            <button
              type="button"
              className="icon-button"
              disabled={leaving}
              aria-label={uk.logout}
              title={uk.logout}
              onClick={async () => {
                setLeaving(true);
                setError('');
                try {
                  await logout();
                } catch {
                  setError(uk.sessionExitError);
                } finally {
                  setLeaving(false);
                }
              }}
            >
              <LogOut size={20} />
            </button>
          </div>
        </header>
        <main id="main-content" className="dashboard">
          {parent && !online && (
            <p className="notice" role="status">
              <WifiOff size={18} />
              {uk.offline}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!parent && <OfflineStatus />}
          {children}
        </main>
        <footer className="dashboard-footer">
          <UserRound size={14} />
          {uk.footer}
          <span>{uk.app}</span>
        </footer>
      </div>
      <nav className="mobile-navigation" aria-label={uk.home}>
        {navLinks}
      </nav>
    </div>
  );
}
