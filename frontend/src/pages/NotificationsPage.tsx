import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { NotificationDto, NotificationsData } from '@kidquest/types';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../app/providers/AuthProvider';
import { api } from '../services/api';
import { uk } from '../lib/i18n';
import { QueryState, Feedback } from '../features/workflows/common';
import { PushSettings } from '../features/notifications/PushSettings';
import { notificationPath } from '../features/notifications/paths';

export default function NotificationsPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const parent = user?.role === 'PARENT';
  const query = useInfiniteQuery({
    queryKey: ['notifications', user?.id, 'inbox'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<NotificationsData>(
        `/notifications?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (page) => page.nextCursor || undefined,
  });
  const mark = useMutation({
    mutationFn: (id: string) =>
      api<NotificationDto>(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  });
  const markAll = useMutation({
    mutationFn: () => api<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  });
  const entries = [
    ...new Map(
      query.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item]),
    ).values(),
  ];
  const unread = query.data?.pages[0]?.unreadCount || 0;
  const formatter = new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <AppShell>
      <div className="workflow-page-heading">
        <div>
          <p className="eyebrow">{parent ? uk.parentEyebrow : uk.childEyebrow}</p>
          <h1>{uk.notifications}</h1>
          <p className="muted">{uk.notificationsLead}</p>
        </div>
        {unread > 0 && (
          <button
            type="button"
            className="button tonal"
            disabled={markAll.isPending || mark.isPending}
            onClick={() => markAll.mutate()}
          >
            <CheckCheck size={18} />
            {uk.notificationReadAll}
          </button>
        )}
      </div>
      <PushSettings />
      <Feedback error={mark.error || markAll.error} />
      <QueryState
        hasData={!parent && query.data !== undefined}
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
      {query.data && !entries.length && (
        <div className="panel empty-state">
          <Bell size={32} />
          <h2>{uk.notificationsEmpty}</h2>
          <p>{uk.notificationsEmptyLead}</p>
        </div>
      )}
      {entries.length > 0 && (
        <section className="notification-list" aria-label={uk.notifications}>
          {entries.map((item) => (
            <article
              key={item.id}
              className={`panel notification-card${item.readAt ? '' : ' unread'}`}
            >
              <span className="notification-icon">
                <Bell size={22} />
              </span>
              <div className="notification-content">
                <div className="notification-meta">
                  <time dateTime={item.createdAt}>
                    {formatter.format(new Date(item.createdAt))}
                  </time>
                  {!item.readAt && <span className="notification-new">{uk.notificationNew}</span>}
                </div>
                <h2>{item.title}</h2>
                <p>{item.body}</p>
                <div className="notification-actions">
                  <Link
                    className="text-button"
                    to={notificationPath(
                      item.path,
                      parent ? '/parent/notifications' : '/child/notifications',
                    )}
                    onClick={() => {
                      if (!item.readAt) mark.mutate(item.id);
                    }}
                  >
                    {uk.notificationOpen}
                    <ArrowUpRight size={17} />
                  </Link>
                  {!item.readAt && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={mark.isPending || markAll.isPending}
                      onClick={() => mark.mutate(item.id)}
                    >
                      <Check size={17} />
                      {uk.notificationRead}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
      {query.hasNextPage && (
        <div className="notification-more">
          <button
            className="button tonal"
            type="button"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? uk.loading : uk.notificationsMore}
          </button>
        </div>
      )}
    </AppShell>
  );
}
