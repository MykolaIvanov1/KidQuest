import type { AccountProfileData } from '@kidquest/types';
import { LOCALE } from '@kidquest/shared';
import { CalendarDays, Trophy, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { uk } from '../../lib/i18n';

export function ProfileDetails({ data }: { data: AccountProfileData }) {
  const parent = data.user.role === 'PARENT';
  return (
    <section className="panel account-profile" aria-labelledby="profile-details-heading">
      <div className="account-profile-title">
        <span className="account-avatar">
          <UserRound size={32} />
        </span>
        <div>
          <h2 id="profile-details-heading">{uk.profileDetails}</h2>
          <p className="muted">{parent ? uk.parent : uk.child}</p>
        </div>
      </div>
      <dl className="account-details">
        <div>
          <dt>{uk.fullName}</dt>
          <dd>{[data.user.firstName, data.user.lastName].filter(Boolean).join(' ')}</dd>
        </div>
        <div>
          <dt>{uk.email}</dt>
          <dd>{data.user.email}</dd>
        </div>
        <div>
          <dt>{uk.accountFamily}</dt>
          <dd>{data.family.name}</dd>
        </div>
        <div>
          <dt>{uk.accountTimeZone}</dt>
          <dd>{data.family.timeZone}</dd>
        </div>
        <div>
          <dt>{uk.accountCreated}</dt>
          <dd>
            {new Intl.DateTimeFormat(LOCALE, {
              dateStyle: 'long',
              timeZone: data.family.timeZone,
            }).format(new Date(data.createdAt))}
          </dd>
        </div>
      </dl>
      {!parent && <p className="muted account-profile-hint">{uk.profileSecurityHint}</p>}
      <div className="account-links">
        <Link className="button tonal" to={parent ? '/parent/statistics' : '/child/calendar'}>
          <CalendarDays size={18} />
          {uk.viewProgress}
        </Link>
        <Link className="button tonal" to={parent ? '/parent/achievements' : '/child/achievements'}>
          <Trophy size={18} />
          {uk.achievements}
        </Link>
      </div>
    </section>
  );
}
