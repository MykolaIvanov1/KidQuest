import type { ProgressData } from '@kidquest/types';
import { BarChart3 } from 'lucide-react';
import { uk } from '../../lib/i18n';
import { formatCalendarDate } from './format';

export function ProgressChart({ data }: { data: ProgressData }) {
  const days = data.days.filter((day) => day.date <= data.today);
  const max = Math.max(1, ...days.map((day) => day.approved));
  const width = 360;
  const plotHeight = 140;
  const slot = (width - 42) / data.days.length;
  return (
    <section className="panel progress-chart-panel" aria-labelledby="progress-chart-title">
      <div className="panel-heading">
        <div>
          <h2 id="progress-chart-title">
            <BarChart3 size={20} />
            {uk.dailyApprovals}
          </h2>
          <p>{uk.chartLead}</p>
        </div>
      </div>
      <figure className="progress-chart">
        <svg
          viewBox={`0 0 ${width} 182`}
          role="img"
          aria-label={uk.chartSummary(data.summary.approved, data.summary.successfulDays)}
        >
          {[0, max].map((value) => (
            <g key={value}>
              <line
                x1="33"
                x2={width}
                y1={158 - (value / max) * plotHeight}
                y2={158 - (value / max) * plotHeight}
                className="chart-line"
              />
              <text
                x="23"
                y={162 - (value / max) * plotHeight}
                textAnchor="end"
                className="chart-label"
              >
                {value}
              </text>
            </g>
          ))}
          {data.days.map((day, index) => {
            const value = day.date <= data.today ? day.approved : 0;
            const height = (value / max) * plotHeight;
            return (
              <g key={day.date} aria-hidden="true">
                <rect
                  x={38 + index * slot}
                  y={158 - height}
                  width={Math.max(1, slot - 6)}
                  height={height}
                  rx="3"
                  className="chart-bar"
                />
                {(index === 0 || (index + 1) % 5 === 0 || index === data.days.length - 1) && (
                  <text
                    x={38 + index * slot + (slot - 6) / 2}
                    y="178"
                    textAnchor="middle"
                    className="chart-label"
                  >
                    {index + 1}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {!data.summary.approved && (
          <figcaption className="chart-empty">
            <strong>{uk.noProgressYet}</strong>
            <p>{uk.noProgressYetLead}</p>
          </figcaption>
        )}
      </figure>
      <details className="chart-data">
        <summary>{uk.chartTable}</summary>
        <div className="chart-table-scroll">
          <table>
            <caption className="visually-hidden">{uk.dailyApprovals}</caption>
            <thead>
              <tr>
                <th scope="col">{uk.chartDate}</th>
                <th scope="col">{uk.approvedTasks}</th>
                <th scope="col">{uk.earnedPoints}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <th scope="row">
                    <time dateTime={day.date}>{formatCalendarDate(day.date, true)}</time>
                  </th>
                  <td>{day.approved}</td>
                  <td>{day.earnedPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
