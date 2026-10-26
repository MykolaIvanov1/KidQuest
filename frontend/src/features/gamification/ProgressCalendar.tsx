import { useState } from 'react';
import type { CalendarData, CalendarDayDto } from '@kidquest/types';
import { CalendarDays, ListChecks, Star } from 'lucide-react';
import { uk } from '../../lib/i18n';
import { formatCalendarDate, formatMonth } from './format';

export function ProgressCalendar({ data }: { data: CalendarData }) {
  const [selection, setSelection] = useState<string | null>(null);
  const available = data.days.filter((day) => day.date <= data.today);
  const selected =
    available.find((day) => day.date === selection) ||
    available.find((day) => day.date === data.today) ||
    available.at(-1);
  const firstDay = new Date(`${data.month}-01T12:00:00Z`).getUTCDay();
  const padding = (firstDay + 6) % 7;
  return (
    <section className="panel history-calendar" aria-labelledby="history-calendar-title">
      <div className="panel-heading">
        <div>
          <h2 id="history-calendar-title">
            <CalendarDays size={20} />
            {uk.calendarHeading}
          </h2>
          <p>{uk.calendarLead}</p>
        </div>
      </div>
      <div className="calendar-body">
        <h3 className="calendar-month">{formatMonth(data.month)}</h3>
        <div className="calendar-weekdays" aria-hidden="true">
          {uk.weekdays.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-grid" role="group" aria-label={formatMonth(data.month)}>
          {Array.from({ length: padding }, (_, index) => (
            <span className="calendar-gap" key={`gap-${index}`} aria-hidden="true" />
          ))}
          {data.days.map((day) => (
            <button
              type="button"
              key={day.date}
              className={`calendar-day calendar-${day.status.toLowerCase()}${day.date === data.today ? ' today' : ''}`}
              disabled={day.status === 'FUTURE' || day.date > data.today}
              aria-label={uk.calendarDayLabel(
                formatCalendarDate(day.date),
                uk.calendarStatuses[day.status],
                day.approved,
                Math.max(day.expected, day.tasks.length),
              )}
              aria-pressed={day.date === selected?.date}
              aria-current={day.date === data.today ? 'date' : undefined}
              onClick={() => setSelection(day.date)}
            >
              <span>{Number(day.date.slice(-2))}</span>
              <span className="calendar-dot" aria-hidden="true" />
            </button>
          ))}
        </div>
        <ul className="calendar-legend" aria-label={uk.calendarLegend}>
          {(['COMPLETE', 'PARTIAL', 'PENDING', 'MISSED', 'EMPTY'] as const).map((status) => (
            <li key={status} className={`calendar-${status.toLowerCase()}`}>
              <span className="calendar-dot" aria-hidden="true" />
              {uk.calendarStatuses[status]}
            </li>
          ))}
        </ul>
      </div>
      {selected && <DayDetails day={selected} />}
    </section>
  );
}

function DayDetails({ day }: { day: CalendarDayDto }) {
  return (
    <div className="calendar-details">
      <div className="calendar-detail-heading">
        <div>
          <h3 aria-live="polite">
            <time dateTime={day.date}>{formatCalendarDate(day.date)}</time>
          </h3>
          <p className="muted">
            {uk.calendarDayProgress(day.approved, Math.max(day.expected, day.tasks.length))}
          </p>
        </div>
        <span className="points-pill">
          <Star size={15} />+{day.earnedPoints}
        </span>
      </div>
      {day.tasks.length ? (
        <ul className="calendar-task-list">
          {day.tasks.map((task) => (
            <li key={task.completionId || task.taskId}>
              <ListChecks size={18} aria-hidden="true" />
              <div>
                <strong>{task.title}</strong>
                {task.isRequired && <small>{uk.requiredBadge}</small>}
              </div>
              <span className={`history-task-status history-${task.status.toLowerCase()}`}>
                {uk.calendarTaskStates[task.status]}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted calendar-no-tasks">{uk.noDayTasks}</p>
      )}
    </div>
  );
}
