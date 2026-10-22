import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  categorySchema,
  taskSchema,
  type CategoryInput,
  type TaskInput,
} from '@kidquest/validation';
import type { TaskCategoryDto, TaskDto } from '@kidquest/types';
import { api } from '../../services/api';
import { Field } from '../../pages/auth/AuthPage';
import { uk } from '../../lib/i18n';
import { Feedback, QueryState, useRefreshFamilyData } from '../workflows/common';

export function TaskEditor({ task, close }: { task?: TaskDto; close: () => void }) {
  const refresh = useRefreshFamilyData();
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<TaskCategoryDto[]>('/task-categories'),
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TaskInput>({
    resolver: zodResolver(taskSchema),
    defaultValues: task
      ? {
          title: task.title,
          description: task.description,
          categoryId: task.categoryId,
          icon: task.icon,
          color: task.color,
          points: task.points,
          isRequired: task.isRequired,
          repeatDaily: task.repeatDaily ?? true,
          photoRequired: task.photoRequired,
          startDate: task.startDate ?? null,
          endDate: task.endDate ?? null,
          startTime: task.startTime,
          endTime: task.endTime,
          isActive: task.isActive,
        }
      : {
          title: '',
          description: '',
          categoryId: '',
          icon: 'ListChecks',
          color: 'primary',
          points: 10,
          isRequired: true,
          repeatDaily: true,
          photoRequired: false,
          startDate: null,
          endDate: null,
          startTime: null,
          endTime: null,
          isActive: true,
        },
  });
  const mutation = useMutation({
    mutationFn: (input: TaskInput) =>
      api(task ? `/tasks/${task.id}` : '/tasks', {
        method: task ? 'PATCH' : 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await refresh();
      close();
    },
  });
  return (
    <section className="editor-panel panel" aria-labelledby="task-editor-title">
      <h2 id="task-editor-title" tabIndex={-1}>
        {task ? uk.editTask : uk.newTask}
      </h2>
      <form noValidate onSubmit={handleSubmit((input) => mutation.mutate(input))}>
        <fieldset disabled={mutation.isPending} className="plain-fieldset">
          <Field label={uk.title} error={errors.title?.message}>
            <input autoFocus {...register('title')} />
          </Field>
          <Field label={uk.description} error={errors.description?.message}>
            <textarea rows={3} {...register('description')} />
          </Field>
          <QueryState
            pending={categories.isPending}
            error={categories.error}
            retry={categories.refetch}
          />
          <div className="form-row">
            <Field label={uk.category} error={errors.categoryId?.message}>
              <select {...register('categoryId')}>
                <option value="">{uk.chooseCategory}</option>
                {categories.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={uk.taskPoints} error={errors.points?.message}>
              <input
                type="number"
                min={1}
                max={100000}
                step={1}
                {...register('points', { valueAsNumber: true })}
              />
            </Field>
          </div>
          <div className="form-row">
            <Field label={uk.startDate} error={errors.startDate?.message}>
              <input
                type="date"
                {...register('startDate', { setValueAs: (value: string) => value || null })}
              />
            </Field>
            <Field label={uk.endDate} error={errors.endDate?.message}>
              <input
                type="date"
                {...register('endDate', { setValueAs: (value: string) => value || null })}
              />
            </Field>
          </div>
          <p className="field-hint">{uk.dateRangeHint}</p>
          <div className="form-row">
            <Field label={uk.startTime} error={errors.startTime?.message}>
              <input
                type="time"
                {...register('startTime', { setValueAs: (value: string) => value || null })}
              />
            </Field>
            <Field label={uk.endTime} error={errors.endTime?.message}>
              <input
                type="time"
                {...register('endTime', { setValueAs: (value: string) => value || null })}
              />
            </Field>
          </div>
          <div className="checkbox-grid">
            <label>
              <input
                type="checkbox"
                aria-describedby="task-repeat-hint"
                {...register('repeatDaily')}
              />
              {uk.repeatDaily}
            </label>
            <label>
              <input type="checkbox" {...register('isRequired')} />
              {uk.requiredTask}
            </label>
            <label>
              <input type="checkbox" {...register('photoRequired')} />
              {uk.requirePhoto}
            </label>
            <label>
              <input type="checkbox" {...register('isActive')} />
              {uk.active}
            </label>
          </div>
          <p id="task-repeat-hint" className="field-hint">
            {uk.repeatDailyHint}
          </p>
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

export function CategoryEditor() {
  const refresh = useRefreshFamilyData();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CategoryInput>({ resolver: zodResolver(categorySchema) });
  const mutation = useMutation({
    mutationFn: (input: CategoryInput) =>
      api('/task-categories', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: async () => {
      reset();
      await refresh();
    },
  });
  return (
    <details className="category-editor panel">
      <summary>{uk.newCategory}</summary>
      <form noValidate onSubmit={handleSubmit((input) => mutation.mutate(input))}>
        <Field label={uk.categoryName} error={errors.name?.message}>
          <input {...register('name')} />
        </Field>
        <Feedback error={mutation.error} success={mutation.isSuccess ? uk.saved : undefined} />
        <button className="button tonal" disabled={mutation.isPending}>
          {mutation.isPending ? uk.wait : uk.addCategory}
        </button>
      </form>
    </details>
  );
}
