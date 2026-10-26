import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { AccountMutationData, PublicUser } from '@kidquest/types';
import { Users } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider';
import { api } from '../../services/api';
import { uk } from '../../lib/i18n';
import { Field } from '../../pages/auth/AuthPage';
import { QueryState, Feedback } from '../workflows/common';
import { ChangeEmailForm, ChangeRoleForm, ResetChildPasswordForm } from './SecurityForms';
import { LoginJournal } from './LoginJournal';

export function FamilyAccountSettings({ timeZone }: { timeZone: string }) {
  const { user, forgetSession } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [selected, setSelected] = useState(user?.id || '');
  const [notice, setNotice] = useState('');
  const members = useQuery({
    queryKey: ['members', user?.familyId],
    queryFn: () => api<PublicUser[]>('/family/members'),
  });
  const member = members.data?.find((item) => item.id === selected) || members.data?.[0];
  const changed = async (result: AccountMutationData) => {
    if (result.reauthenticate) {
      const cleanup = forgetSession();
      navigate('/login', { replace: true, state: { accountChanged: true } });
      await cleanup;
      return;
    }
    setNotice(result.updated ? uk.saved : uk.accountUnchanged);
    await Promise.all(
      ['members', 'account-profile', 'login-journal', 'dashboard'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  };
  return (
    <>
      <section
        className="panel family-account-settings"
        aria-labelledby="account-management-heading"
      >
        <h2 id="account-management-heading">
          <Users size={22} />
          {uk.accountManagement}
        </h2>
        <p className="muted">{uk.accountManagementHint}</p>
        <QueryState pending={members.isPending} error={members.error} retry={members.refetch} />
        {member && (
          <>
            <Field label={uk.selectedMember}>
              <select
                value={member.id}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setNotice('');
                }}
              >
                {members.data!.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.firstName} — {item.role === 'PARENT' ? uk.parent : uk.child} ({item.email}
                    )
                  </option>
                ))}
              </select>
            </Field>
            <Feedback success={notice} />
            <div
              className="account-security-grid"
              key={`${member.id}-${member.role}-${member.email}`}
            >
              <ChangeEmailForm member={member} changed={changed} />
              {member.role === 'CHILD' && (
                <ResetChildPasswordForm member={member} changed={changed} />
              )}
              <ChangeRoleForm member={member} changed={changed} />
            </div>
          </>
        )}
      </section>
      {members.data && <LoginJournal members={members.data} timeZone={timeZone} />}
    </>
  );
}
