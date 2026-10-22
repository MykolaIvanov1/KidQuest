import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DashboardData } from '@kidquest/types';
import { api } from '../services/api';

export function useFamilyDayRefresh(userId?: string) {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: ['dashboard', userId],
    queryFn: () => api<DashboardData>('/statistics'),
    enabled: !!userId,
  });
  const timeZone = data?.family.timeZone;

  useEffect(() => {
    if (!userId || !timeZone) return;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    let day = formatter.format(new Date());
    const checkDay = () => {
      const nextDay = formatter.format(new Date());
      if (nextDay === day) return;
      day = nextDay;
      void Promise.all(
        ['tasks', 'dashboard', 'completions', 'points', 'point-history'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    };
    // Check the calendar day rather than adding 24 hours: DST can change a day's length.
    const interval = window.setInterval(checkDay, 30_000);
    window.addEventListener('focus', checkDay);
    window.addEventListener('online', checkDay);
    document.addEventListener('visibilitychange', checkDay);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', checkDay);
      window.removeEventListener('online', checkDay);
      document.removeEventListener('visibilitychange', checkDay);
    };
  }, [client, userId, timeZone]);
}
