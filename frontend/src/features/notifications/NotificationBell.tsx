import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { NotificationsData } from '@kidquest/types';
import { useAuth } from '../../app/providers/AuthProvider';
import { api } from '../../services/api';
import { uk } from '../../lib/i18n';

export function NotificationBell() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['notifications', user?.id, 'unread'],
    queryFn: () => api<NotificationsData>('/notifications?limit=1'),
    enabled: Boolean(user),
    refetchInterval: 30_000,
    retry: false,
  });
  const count = query.data?.unreadCount || 0;
  return (
    <Link
      to={user?.role === 'PARENT' ? '/parent/notifications' : '/child/notifications'}
      className="icon-button notification-bell"
      aria-label={count ? uk.notificationUnread(count) : uk.notifications}
      title={uk.notifications}
    >
      <Bell size={20} />
      {count > 0 && (
        <span className="notification-badge" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
