import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { TaskDto } from '@kidquest/types';
import {
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  CloudUpload,
  ListChecks,
  Repeat2,
  Send,
  Star,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../../services/api';
import { uk } from '../../lib/i18n';
import { useOffline } from '../offline/OfflineProvider';
import { familyDate } from '../offline/cache';
import { QuestykTaskHelp } from '../ai/QuestykLauncher';
import { Feedback, QueryState } from '../workflows/common';

function calendarDate(value: string) {
  return new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function taskDates(task: TaskDto) {
  if (task.startDate && task.endDate)
    return task.startDate === task.endDate
      ? calendarDate(task.startDate)
      : uk.dateRange(calendarDate(task.startDate), calendarDate(task.endDate));
  if (task.startDate) return uk.dateFrom(calendarDate(task.startDate));
  return task.endDate ? uk.dateThrough(calendarDate(task.endDate)) : '';
}

export function TaskList({
  parent = false,
  edit,
  remove,
}: {
  parent?: boolean;
  edit?: (task: TaskDto) => void;
  remove?: (task: TaskDto) => React.ReactNode;
}) {
  const query = useQuery({ queryKey: ['tasks'], queryFn: () => api<TaskDto[]>('/tasks') });
  return (
    <>
      <QueryState
        hasData={!parent && query.data !== undefined}
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
      {query.data && !query.data.length && (
        <div className="empty-state">
          <span className="empty-art">
            <ListChecks size={35} />
          </span>
          <h3>{uk.noTasks}</h3>
          <p>{parent ? uk.noTasksParent : uk.noTasksChild}</p>
        </div>
      )}
      <div className="workflow-list">
        {query.data?.map((task) => (
          <TaskCard key={task.id} task={task} parent={parent} edit={edit} remove={remove} />
        ))}
      </div>
    </>
  );
}

function TaskCard({
  task,
  parent,
  edit,
  remove,
}: {
  task: TaskDto;
  parent: boolean;
  edit?: (task: TaskDto) => void;
  remove?: (task: TaskDto) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const offline = useOffline();
  const today = familyDate(offline.timeZone);
  const queued = offline.pending.find(
    (item) =>
      item.taskId === task.id && (task.repeatDaily === false || item.completionDate === today),
  );
  const completion = task.todayCompletion;
  const status = completion?.status || 'PENDING';
  const maySubmit = !queued && (status === 'PENDING' || status === 'REJECTED');
  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: () => offline.queueTask(task, files),
    onSuccess: () => {
      setFiles([]);
      setOpen(false);
    },
  });
  function validateFiles(selected: File[]) {
    if (selected.length > 5) return uk.photoCountError;
    if (selected.some((file) => file.size > 5 * 1024 * 1024)) return uk.photoSizeError;
    if (selected.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)))
      return uk.photoTypeError;
    return '';
  }
  return (
    <motion.article
      className={`workflow-card task-workflow-card status-${status.toLowerCase()}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="workflow-card-heading">
        <span className="task-icon">
          <ListChecks size={23} />
        </span>
        <div>
          <h3>{task.title}</h3>
          <span className="metadata">{task.category.name}</span>
        </div>
        <span className="points-pill">
          <Star size={15} />+{task.points}
        </span>
      </div>
      {task.description && <p className="workflow-description">{task.description}</p>}
      <div className="badge-row">
        {parent ? (
          <span className={`status-chip ${task.isActive ? '' : 'subdued'}`}>
            {task.isActive ? uk.active : uk.inactive}
          </span>
        ) : (
          <span
            className={`status-chip ${queued ? (queued.status === 'FAILED' ? 'queue-failed' : 'queued') : status.toLowerCase()}`}
          >
            {queued ? (
              <CloudUpload size={15} />
            ) : (
              status === 'APPROVED' && <CheckCircle2 size={15} />
            )}
            {queued
              ? queued.status === 'FAILED'
                ? uk.taskQueueFailed
                : queued.status === 'SENDING'
                  ? uk.taskQueueSending
                  : uk.taskQueued
              : uk.taskStates[status]}
          </span>
        )}
        {task.isRequired && <span className="metadata">{uk.requiredBadge}</span>}
        <span className="metadata">
          <Repeat2 size={14} />
          {(task.repeatDaily ?? true) ? uk.dailyBadge : uk.noRepeatBadge}
        </span>
        {task.photoRequired && (
          <span className="metadata">
            <Camera size={14} />
            {uk.photoRequired}
          </span>
        )}
        {(task.startDate || task.endDate) && (
          <span className="metadata" aria-label={uk.taskDateRange}>
            <CalendarDays size={14} />
            {taskDates(task)}
          </span>
        )}
        {(task.startTime || task.endTime) && (
          <span className="metadata">
            <Clock3 size={14} />
            {task.startTime || '—'} – {task.endTime || '—'}
          </span>
        )}
      </div>
      {completion?.rejectionReason && <p className="review-reason">{completion.rejectionReason}</p>}
      {parent ? (
        <div className="workflow-actions">
          <button type="button" className="button tonal" onClick={() => edit?.(task)}>
            {uk.edit}
          </button>
          {remove?.(task)}
        </div>
      ) : (
        <>
          <QuestykTaskHelp taskId={task.id} />
          <Feedback
            error={mutation.error}
            success={
              mutation.isSuccess
                ? queued
                  ? uk.taskQueuedHint
                  : status === 'SUBMITTED'
                    ? uk.taskSubmitted
                    : undefined
                : undefined
            }
          />
          {maySubmit && offline.ready && !offline.available && (
            <p className="field-hint">{uk.taskQueueStorageHint}</p>
          )}
          {maySubmit && !open && (
            <button
              type="button"
              className="button primary"
              disabled={!offline.ready || !offline.available}
              onClick={() => {
                setOpen(true);
                mutation.reset();
              }}
            >
              {status === 'REJECTED' ? uk.resubmitTask : uk.completeTask}
              <CheckCircle2 size={18} />
            </button>
          )}
          {maySubmit && open && (
            <form
              className="submission-form"
              onSubmit={(event) => {
                event.preventDefault();
                const invalid =
                  validateFiles(files) ||
                  (task.photoRequired && !files.length ? uk.photoRequiredError : '');
                setFileError(invalid);
                if (!invalid) mutation.mutate();
              }}
            >
              <label className="field">
                <span>
                  {uk.photoLabel}
                  {task.photoRequired ? ' *' : ''}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={mutation.isPending}
                  onChange={(event) => {
                    const selected = Array.from(event.target.files || []);
                    setFileError(validateFiles(selected));
                    setFiles(selected);
                  }}
                />
                <small className="field-hint">{uk.photoHint}</small>
              </label>
              {!!files.length && <p className="metadata">{uk.photoCount(files.length)}</p>}
              {fileError && (
                <p className="field-error" role="alert">
                  {fileError}
                </p>
              )}
              <div className="workflow-actions">
                <button
                  className="button primary"
                  disabled={mutation.isPending || !offline.ready || !offline.available}
                >
                  <Send size={17} />
                  {mutation.isPending ? uk.wait : uk.taskQueueSubmit}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={mutation.isPending}
                  onClick={() => setOpen(false)}
                >
                  {uk.cancel}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </motion.article>
  );
}
