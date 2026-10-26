import { LOCALE } from '@kidquest/shared';

export function formatCalendarDate(date: string, short = false) {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    day: 'numeric',
    month: short ? 'short' : 'long',
    year: short ? undefined : 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
}

export function formatMonth(month: string) {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-01T12:00:00Z`));
}

export function moveMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
