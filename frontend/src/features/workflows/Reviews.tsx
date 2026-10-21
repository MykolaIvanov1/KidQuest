import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { reviewSchema, type ReviewInput } from '@kidquest/validation';
import type { TaskCompletionDto, TaskPhotoDto, RewardRequestDto } from '@kidquest/types';
import { Camera, CheckCircle2, ClipboardCheck, Gift, Star } from 'lucide-react';
import { motion } from 'framer-motion';
import { api, apiBlob } from '../../services/api';
import { uk } from '../../lib/i18n';
import { Field } from '../../pages/auth/AuthPage';
import { Feedback, QueryState, useRefreshFamilyData } from './common';

function PrivatePhoto({ photo, index }: { photo: TaskPhotoDto; index: number }) {
  const image = useQuery({
    queryKey: ['private-photo', photo.id],
    queryFn: () => apiBlob(`/task-photos/${photo.id}`),
    staleTime: Infinity,
  });
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!image.data) return;
    const objectUrl = URL.createObjectURL(image.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image.data]);
  return (
    <div className="completion-photo">
      <QueryState pending={image.isPending} error={image.error} retry={image.refetch} />
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={uk.photoAlt(index)} />
        </a>
      )}
    </div>
  );
}

function ReviewActions({
  path,
  canIssue = false,
  onSuccess,
}: {
  path: string;
  canIssue?: boolean;
  onSuccess: (action: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ReviewInput>({ resolver: zodResolver(reviewSchema), defaultValues: { reason: '' } });
  const refresh = useRefreshFamilyData();
  const mutation = useMutation({
    mutationFn: ({ action, reason }: { action: 'approve' | 'reject' | 'issue'; reason?: string }) =>
      api(`${path}/${action}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }),
    onSuccess: async (_result, input) => {
      onSuccess(input.action);
      setRejecting(false);
      await refresh();
    },
  });
  return (
    <>
      <Feedback error={mutation.error} />
      <div className="workflow-actions">
        <button
          type="button"
          className="button primary"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ action: canIssue ? 'issue' : 'approve' })}
        >
          <CheckCircle2 size={17} />
          {mutation.isPending ? uk.wait : canIssue ? uk.issueReward : uk.approve}
        </button>
        {!canIssue && (
          <button
            type="button"
            className="button tonal"
            disabled={mutation.isPending}
            onClick={() => setRejecting((value) => !value)}
          >
            {uk.reject}
          </button>
        )}
      </div>
      {rejecting && (
        <form
          className="rejection-form"
          noValidate
          onSubmit={handleSubmit(({ reason }) => mutation.mutate({ action: 'reject', reason }))}
        >
          <Field label={uk.rejectionReason} error={errors.reason?.message}>
            <textarea rows={2} maxLength={1000} {...register('reason')} />
          </Field>
          <button className="button tonal" disabled={mutation.isPending}>
            {mutation.isPending ? uk.wait : uk.reject}
          </button>
          <button type="button" className="text-button" onClick={() => setRejecting(false)}>
            {uk.cancel}
          </button>
        </form>
      )}
    </>
  );
}

export function TaskReviews() {
  const query = useQuery({
    queryKey: ['completions'],
    queryFn: () => api<TaskCompletionDto[]>('/task-completions'),
  });
  const [message, setMessage] = useState('');
  const pending = query.data?.filter((completion) => completion.status === 'SUBMITTED') || [];
  return (
    <section className="panel review-panel">
      <div className="panel-heading">
        <div>
          <h2>
            <ClipboardCheck size={20} />
            {uk.taskReview}
          </h2>
          <p>{uk.taskReviewLead}</p>
        </div>
        <span className="count-pill">{pending.length}</span>
      </div>
      <div className="review-content">
        <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
        <Feedback success={message} />
        {message.includes(uk.taskStates.APPROVED.toLowerCase()) && (
          <motion.div
            className="approval-sparkles"
            aria-hidden="true"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 2 }}
          >
            {Array.from({ length: 7 }, (_, index) => (
              <motion.span
                key={index}
                initial={{ x: 0, y: 0 }}
                animate={{ x: (index - 3) * 25, y: -45 - index * 5, rotate: index * 50 }}
              >
                ✦
              </motion.span>
            ))}
          </motion.div>
        )}
        {query.data && !pending.length && (
          <div className="empty-state compact">
            <h3>{uk.nothingToReview}</h3>
            <p>{uk.nothingToReviewLead}</p>
          </div>
        )}
        {pending.map((completion) => (
          <CompletionReview
            key={completion.id}
            completion={completion}
            onSuccess={(action) =>
              setMessage(
                action === 'approve' ? uk.approvedPoints(completion.pointsSnapshot) : uk.rejected,
              )
            }
          />
        ))}
      </div>
    </section>
  );
}

function CompletionReview({
  completion,
  onSuccess,
}: {
  completion: TaskCompletionDto;
  onSuccess: (action: string) => void;
}) {
  const [photosOpen, setPhotosOpen] = useState(false);
  return (
    <article className="review-card">
      <div className="workflow-card-heading">
        <div>
          <h3>{completion.taskTitle}</h3>
          <p className="metadata">
            {completion.childName} ·{' '}
            {new Intl.DateTimeFormat('uk-UA', {
              day: 'numeric',
              month: 'long',
              timeZone: 'UTC',
            }).format(new Date(`${completion.completionDate}T12:00:00Z`))}
          </p>
        </div>
        <span className="points-pill">
          <Star size={15} />+{completion.pointsSnapshot}
        </span>
      </div>
      {!!completion.photos.length && (
        <>
          <button
            type="button"
            className="text-button"
            aria-expanded={photosOpen}
            onClick={() => setPhotosOpen((value) => !value)}
          >
            <Camera size={17} />
            {photosOpen ? uk.hidePhotos : uk.viewPhotos} ({completion.photos.length})
          </button>
          {photosOpen && (
            <div className="completion-photos">
              {completion.photos.map((photo, index) => (
                <PrivatePhoto key={photo.id} photo={photo} index={index} />
              ))}
            </div>
          )}
        </>
      )}
      <ReviewActions path={`/task-completions/${completion.id}`} onSuccess={onSuccess} />
    </article>
  );
}

export function RewardRequests({ parent = false }: { parent?: boolean }) {
  const query = useQuery({
    queryKey: ['reward-requests'],
    queryFn: () => api<RewardRequestDto[]>('/reward-requests'),
  });
  const [message, setMessage] = useState('');
  const rows = parent
    ? query.data?.filter((request) => ['PENDING', 'APPROVED'].includes(request.status))
    : query.data;
  return (
    <section className="panel review-panel">
      <div className="panel-heading">
        <div>
          <h2>
            <Gift size={20} />
            {parent ? uk.rewardReview : uk.rewardHistory}
          </h2>
          <p>{parent ? uk.rewardRequestsLead : uk.aboutPoints}</p>
        </div>
      </div>
      <div className="review-content">
        <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
        <Feedback success={message} />
        {rows && !rows.length && (
          <div className="empty-state compact">
            <h3>{uk.noRewardRequests}</h3>
          </div>
        )}
        {rows?.map((request) => (
          <article className="review-card" key={request.id}>
            <div className="workflow-card-heading">
              <div>
                <h3>{request.rewardTitle}</h3>
                <p className="metadata">
                  {parent && `${request.childName} · `}
                  {new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' }).format(
                    new Date(request.createdAt),
                  )}
                </p>
              </div>
              <span className="points-pill">
                {request.costSnapshot} {uk.points}
              </span>
            </div>
            <p className={`status-chip ${request.status.toLowerCase()}`}>
              {uk.rewardStates[request.status]}
            </p>
            {request.rejectionReason && <p className="review-reason">{request.rejectionReason}</p>}
            {parent && (
              <ReviewActions
                path={`/reward-requests/${request.id}`}
                canIssue={request.status === 'APPROVED'}
                onSuccess={(action) =>
                  setMessage(
                    action === 'issue'
                      ? uk.rewardIssued
                      : action === 'approve'
                        ? uk.rewardApproved
                        : uk.rewardRejected,
                  )
                }
              />
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
