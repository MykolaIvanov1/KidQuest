import { useQuery } from '@tanstack/react-query';
import type { AccountProfileData } from '@kidquest/types';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../app/providers/AuthProvider';
import { api } from '../services/api';
import { uk } from '../lib/i18n';
import { QueryState } from '../features/workflows/common';
import { PushSettings } from '../features/notifications/PushSettings';
import { ProfileDetails } from '../features/account/ProfileDetails';
import { FamilyAccountSettings } from '../features/account/FamilyAccountSettings';

export default function AccountPage() {
  const { user } = useAuth();
  const parent = user?.role === 'PARENT';
  const profile = useQuery({
    queryKey: ['account-profile', user?.id],
    queryFn: () => api<AccountProfileData>('/account/profile'),
  });
  return (
    <AppShell>
      <div className="workflow-page-heading">
        <div>
          <p className="eyebrow">{parent ? uk.parentEyebrow : uk.childEyebrow}</p>
          <h1>{parent ? uk.settings : uk.profile}</h1>
          <p className="muted">{parent ? uk.settingsLead : uk.profileLead}</p>
        </div>
      </div>
      <QueryState
        hasData={!parent && profile.data !== undefined}
        pending={profile.isPending}
        error={profile.error}
        retry={profile.refetch}
      />
      {profile.data && (
        <>
          <ProfileDetails data={profile.data} />
          <PushSettings />
          {parent && <FamilyAccountSettings timeZone={profile.data.family.timeZone} />}
        </>
      )}
    </AppShell>
  );
}
