import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  changeEmailSchema,
  changeRoleSchema,
  resetChildPasswordSchema,
  type ChangeEmailInput,
  type ChangeRoleInput,
} from '@kidquest/validation';
import type { AccountMutationData, PublicUser } from '@kidquest/types';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { api } from '../../services/api';
import { Field } from '../../pages/auth/AuthPage';
import { useOnline } from '../../hooks/useOnline';
import { Feedback } from '../workflows/common';
import { uk } from '../../lib/i18n';

type Changed = (result: AccountMutationData) => Promise<void>;
const passwordFormSchema = resetChildPasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: uk.passwordConfirmationError,
    path: ['confirmPassword'],
  });
type PasswordFormInput = z.infer<typeof passwordFormSchema>;

// Keep passwords out of the query/mutation cache: only the in-flight request owns them.
function useSecurityAction(message: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [success, setSuccess] = useState('');
  const online = useOnline();
  const perform = async (path: string, method: string, body: unknown) => {
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      const result = await api<AccountMutationData>(path, { method, body: JSON.stringify(body) });
      setSuccess(result.updated ? message : uk.accountUnchanged);
      return result;
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(uk.genericError));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, success, disabled: busy || !online, perform };
}

export function ChangeEmailForm({ member, changed }: { member: PublicUser; changed: Changed }) {
  const action = useSecurityAction(uk.emailChanged);
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors },
  } = useForm<ChangeEmailInput>({
    resolver: zodResolver(changeEmailSchema),
    defaultValues: { email: member.email, currentPassword: '' },
  });
  return (
    <form
      className="account-security-form"
      aria-labelledby="change-email-heading"
      noValidate
      onSubmit={handleSubmit(async (data) => {
        const result = await action.perform(`/account/members/${member.id}/email`, 'PATCH', data);
        resetField('currentPassword');
        if (result) await changed(result);
      })}
    >
      <h3 id="change-email-heading">
        <Mail size={20} />
        {uk.changeEmail}
      </h3>
      <Field label={uk.newEmail} error={errors.email?.message}>
        <input
          type="email"
          autoComplete="off"
          aria-invalid={!!errors.email}
          {...register('email')}
        />
      </Field>
      <Field label={uk.currentParentPassword} error={errors.currentPassword?.message}>
        <input
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.currentPassword}
          {...register('currentPassword')}
        />
      </Field>
      <Feedback error={action.error} success={action.success} />
      <button className="button primary" disabled={action.disabled}>
        {action.busy ? uk.wait : uk.changeEmail}
      </button>
    </form>
  );
}

export function ResetChildPasswordForm({
  member,
  changed,
}: {
  member: PublicUser;
  changed: Changed;
}) {
  const action = useSecurityAction(uk.childPasswordChanged);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordFormInput>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  return (
    <form
      className="account-security-form"
      aria-labelledby="reset-password-heading"
      noValidate
      onSubmit={handleSubmit(async ({ currentPassword, newPassword }) => {
        const result = await action.perform(
          `/account/members/${member.id}/reset-password`,
          'POST',
          { currentPassword, newPassword },
        );
        reset();
        if (result) await changed(result);
      })}
    >
      <h3 id="reset-password-heading">
        <KeyRound size={20} />
        {uk.resetChildPassword}
      </h3>
      <p className="muted">{uk.passwordResetHint}</p>
      <Field label={uk.newChildPassword} error={errors.newPassword?.message}>
        <input
          type="password"
          autoComplete="new-password"
          aria-label={uk.newChildPassword}
          aria-invalid={!!errors.newPassword}
          {...register('newPassword')}
        />
        <small className="field-hint">{uk.passwordHint}</small>
      </Field>
      <Field label={uk.confirmNewPassword} error={errors.confirmPassword?.message}>
        <input
          type="password"
          autoComplete="new-password"
          aria-label={uk.confirmNewPassword}
          aria-invalid={!!errors.confirmPassword}
          {...register('confirmPassword')}
        />
      </Field>
      <Field label={uk.currentParentPassword} error={errors.currentPassword?.message}>
        <input
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.currentPassword}
          {...register('currentPassword')}
        />
      </Field>
      <Feedback error={action.error} success={action.success} />
      <button className="button primary" disabled={action.disabled}>
        {action.busy ? uk.wait : uk.resetChildPassword}
      </button>
    </form>
  );
}

export function ChangeRoleForm({ member, changed }: { member: PublicUser; changed: Changed }) {
  const action = useSecurityAction(uk.roleChanged);
  const {
    register,
    handleSubmit,
    resetField,
    watch,
    formState: { errors },
  } = useForm<ChangeRoleInput>({
    resolver: zodResolver(changeRoleSchema),
    defaultValues: { role: member.role, currentPassword: '' },
  });
  return (
    <form
      className="account-security-form"
      aria-labelledby="change-role-heading"
      noValidate
      onSubmit={handleSubmit(async (data) => {
        const result = await action.perform(`/account/members/${member.id}/role`, 'PATCH', data);
        resetField('currentPassword');
        if (result) await changed(result);
      })}
    >
      <h3 id="change-role-heading">
        <ShieldCheck size={20} />
        {uk.changeRole}
      </h3>
      <p className="muted">{uk.roleChangeHint}</p>
      <Field label={uk.newRole} error={errors.role?.message}>
        <select aria-invalid={!!errors.role} {...register('role')}>
          <option value="CHILD">{uk.child}</option>
          <option value="PARENT">{uk.parent}</option>
        </select>
      </Field>
      <Field label={uk.currentParentPassword} error={errors.currentPassword?.message}>
        <input
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.currentPassword}
          {...register('currentPassword')}
        />
      </Field>
      <Feedback error={action.error} success={action.success} />
      <button
        className="button primary"
        disabled={action.disabled || watch('role') === member.role}
      >
        {action.busy ? uk.wait : uk.changeRole}
      </button>
    </form>
  );
}
