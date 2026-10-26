import type { AchievementDto } from '@kidquest/types';
import { Check, Flame, ListChecks, LockKeyhole, Star } from 'lucide-react';
import { LOCALE } from '@kidquest/shared';
import { uk } from '../../lib/i18n';

export function AchievementCard({
  achievement,
  timeZone,
}: {
  achievement: AchievementDto;
  timeZone: string;
}) {
  const Icon =
    achievement.type === 'STREAK'
      ? Flame
      : achievement.type === 'APPROVED_TASKS'
        ? ListChecks
        : Star;
  const current = Math.min(achievement.progress, achievement.target);
  const earned = !!achievement.earnedAt;
  return (
    <article className={`achievement-tile${earned ? ' earned' : ''}`}>
      <div className="achievement-tile-heading">
        <span className="achievement-symbol" aria-hidden="true">
          <Icon size={29} />
        </span>
        <span className={`achievement-state${earned ? ' earned' : ''}`}>
          {earned ? <Check size={15} /> : <LockKeyhole size={14} />}
          {earned ? uk.achievementEarned : uk.achievementLocked}
        </span>
      </div>
      <h2>{achievement.title}</h2>
      <p className="muted">{achievement.description}</p>
      <div className="achievement-meter">
        <progress aria-label={achievement.title} max={achievement.target} value={current} />
        <strong>{uk.achievementProgress(current, achievement.target)}</strong>
      </div>
      {achievement.earnedAt && (
        <p className="achievement-earned-date">
          <time dateTime={achievement.earnedAt}>
            {uk.earnedOn(
              new Intl.DateTimeFormat(LOCALE, {
                timeZone,
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }).format(new Date(achievement.earnedAt)),
            )}
          </time>
        </p>
      )}
    </article>
  );
}
