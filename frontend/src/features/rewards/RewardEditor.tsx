import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { rewardSchema, rewardTypes, type RewardInput } from '@kidquest/validation';
import type { RewardDto } from '@kidquest/types';
import { api } from '../../services/api';
import { Field } from '../../pages/auth/AuthPage';
import { uk } from '../../lib/i18n';
import { Feedback, useRefreshFamilyData } from '../workflows/common';

export function RewardEditor({ reward, close }: { reward?: RewardDto; close: () => void }) {
  const refresh = useRefreshFamilyData();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RewardInput>({
    resolver: zodResolver(rewardSchema),
    defaultValues: reward
      ? {
          title: reward.title,
          description: reward.description,
          icon: reward.icon,
          imageUrl: reward.imageUrl,
          cost: reward.cost,
          type: reward.type,
          isActive: reward.isActive,
        }
      : {
          title: '',
          description: '',
          icon: 'Gift',
          imageUrl: null,
          cost: 50,
          type: 'OTHER',
          isActive: true,
        },
  });
  const mutation = useMutation({
    mutationFn: (input: RewardInput) =>
      api(reward ? `/rewards/${reward.id}` : '/rewards', {
        method: reward ? 'PATCH' : 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await refresh();
      close();
    },
  });
  return (
    <section className="editor-panel panel" aria-labelledby="reward-editor-title">
      <h2 id="reward-editor-title">{reward ? uk.editReward : uk.newReward}</h2>
      <form noValidate onSubmit={handleSubmit((input) => mutation.mutate(input))}>
        <fieldset disabled={mutation.isPending} className="plain-fieldset">
          <Field label={uk.title} error={errors.title?.message}>
            <input autoFocus {...register('title')} />
          </Field>
          <Field label={uk.description} error={errors.description?.message}>
            <textarea rows={3} {...register('description')} />
          </Field>
          <div className="form-row">
            <Field label={uk.cost} error={errors.cost?.message}>
              <input
                type="number"
                min={1}
                max={1000000}
                step={1}
                {...register('cost', { valueAsNumber: true })}
              />
            </Field>
            <Field label={uk.rewardType} error={errors.type?.message}>
              <select {...register('type')}>
                {rewardTypes.map((type) => (
                  <option key={type} value={type}>
                    {uk.rewardTypes[type]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="checkbox-grid">
            <label>
              <input type="checkbox" {...register('isActive')} />
              {uk.active}
            </label>
          </div>
          <Feedback error={mutation.error} />
          <div className="workflow-actions">
            <button className="button primary">{mutation.isPending ? uk.wait : uk.save}</button>
            <button type="button" className="text-button" onClick={close}>
              {uk.cancel}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
