import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { memberSchema, type MemberInput } from '@kidquest/validation';
import { CheckCircle2, Plus, X } from 'lucide-react';
import { api } from '../../services/api';
import { Field } from '../../pages/auth/AuthPage';
import { uk } from '../../lib/i18n';
export function MemberForm() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MemberInput>({
    resolver: zodResolver(memberSchema),
    defaultValues: { role: 'CHILD' },
  });
  const mutation = useMutation({
    mutationFn: (data: MemberInput) =>
      api('/family/members', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      reset();
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  return (
    <>
      <button
        className="button tonal"
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          mutation.reset();
        }}
      >
        {open ? <X size={18} /> : <Plus size={18} />}
        {uk.addMember}
      </button>
      {mutation.isSuccess && (
        <p role="status" className="success-message member-success">
          <CheckCircle2 size={20} />
          {uk.memberSuccess}
        </p>
      )}
      {open && (
        <form
          className="member-form"
          noValidate
          onSubmit={handleSubmit((data) => mutation.mutate(data))}
        >
          <p className="muted">{uk.memberHint}</p>
          <div className="form-row">
            <Field label={uk.firstName} error={errors.firstName?.message}>
              <input autoComplete="off" {...register('firstName')} />
            </Field>
            <Field label={uk.memberRole} error={errors.role?.message}>
              <select {...register('role')}>
                <option value="CHILD">{uk.child}</option>
                <option value="PARENT">{uk.parent}</option>
              </select>
            </Field>
          </div>
          <Field label={uk.email} error={errors.email?.message}>
            <input type="email" autoComplete="off" {...register('email')} />
          </Field>
          <Field label={uk.password} error={errors.password?.message}>
            <input type="password" autoComplete="new-password" {...register('password')} />
            <small className="field-hint">{uk.passwordHint}</small>
          </Field>
          {mutation.isError && (
            <p role="alert" className="form-error">
              {mutation.error.message}
            </p>
          )}
          <button className="button primary" disabled={mutation.isPending}>
            {mutation.isPending ? uk.wait : uk.memberSubmit}
          </button>
        </form>
      )}
    </>
  );
}
