export function familyClock(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === name)!.value;
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
  };
}

export function dateColumn(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}
