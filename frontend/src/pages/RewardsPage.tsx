import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { PointsData, RewardDto, RewardRequestDto } from '@kidquest/types';
import { Gift, Plus, Star } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../app/providers/AuthProvider';
import { RewardEditor } from '../features/rewards/RewardEditor';
import { RewardRequests } from '../features/workflows/Reviews';
import {
  DeleteAction,
  Feedback,
  QueryState,
  useOperationId,
  useRefreshFamilyData,
} from '../features/workflows/common';
import { useOnline } from '../hooks/useOnline';
import { api } from '../services/api';
import { uk } from '../lib/i18n';

export default function RewardsPage() {
  const parent = useAuth().user?.role === 'PARENT';
  const [editing, setEditing] = useState<RewardDto | 'new' | null>(null);
  const query = useQuery({ queryKey: ['rewards'], queryFn: () => api<RewardDto[]>('/rewards') });
  const points = useQuery({
    queryKey: ['points'],
    queryFn: () => api<PointsData>('/points'),
    enabled: !parent,
  });
  const requests = useQuery({
    queryKey: ['reward-requests', 'active'],
    queryFn: () => api<RewardRequestDto[]>('/reward-requests?status=PENDING,APPROVED'),
    enabled: !parent,
  });
  const refresh = useRefreshFamilyData();
  const remove = useMutation({
    mutationFn: (reward: RewardDto) => api(`/rewards/${reward.id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return (
    <AppShell>
      <div className="workflow-page-heading">
        <div>
          <p className="eyebrow">{parent ? uk.parentEyebrow : uk.childEyebrow}</p>
          <h1>{uk.rewards}</h1>
          <p className="muted">{uk.rewardLead}</p>
        </div>
        {parent ? (
          <button className="button primary" onClick={() => setEditing('new')}>
            <Plus size={18} />
            {uk.newReward}
          </button>
        ) : (
          <div className="balance-chip">
            <Star size={20} />
            <strong>{points.data?.balance ?? '—'}</strong> {uk.points}
          </div>
        )}
      </div>
      {parent && editing && (
        <RewardEditor
          key={editing === 'new' ? 'new' : editing.id}
          reward={editing === 'new' ? undefined : editing}
          close={() => setEditing(null)}
        />
      )}
      <Feedback error={remove.error} success={remove.isSuccess ? uk.deleted : undefined} />
      <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
      {!parent && (
        <QueryState pending={points.isPending} error={points.error} retry={points.refetch} />
      )}
      {!parent && (
        <QueryState pending={requests.isPending} error={requests.error} retry={requests.refetch} />
      )}
      {query.data && !query.data.length && (
        <div className="empty-state panel">
          <span className="empty-art gift-art">
            <Gift size={35} />
          </span>
          <h3>{uk.noRewards}</h3>
          <p>{uk.noRewardsLead}</p>
        </div>
      )}
      <div className="reward-catalog">
        {query.data?.map((reward) => (
          <RewardCard
            key={reward.id}
            reward={reward}
            parent={parent}
            balance={points.data?.balance}
            requestReady={parent || (points.isSuccess && requests.isSuccess)}
            pending={
              requests.data?.some(
                (request) =>
                  request.rewardId === reward.id &&
                  ['PENDING', 'APPROVED'].includes(request.status),
              ) || false
            }
            edit={() => setEditing(reward)}
            remove={
              <DeleteAction pending={remove.isPending} remove={() => remove.mutate(reward)} />
            }
          />
        ))}
      </div>
      <RewardRequests parent={parent} />
    </AppShell>
  );
}

function RewardCard({
  reward,
  parent,
  balance,
  pending,
  requestReady,
  edit,
  remove,
}: {
  reward: RewardDto;
  parent: boolean;
  balance?: number;
  pending: boolean;
  requestReady: boolean;
  edit: () => void;
  remove: React.ReactNode;
}) {
  const operation = useOperationId();
  const refresh = useRefreshFamilyData();
  const online = useOnline();
  const mutation = useMutation({
    mutationFn: () =>
      api(`/rewards/${reward.id}/request`, {
        method: 'POST',
        body: JSON.stringify({ operationId: operation.current() }),
      }),
    onSuccess: async () => {
      operation.renew();
      await refresh();
    },
  });
  const affordable = balance !== undefined && balance >= reward.cost;
  return (
    <article className="workflow-card reward-catalog-card">
      <span className="reward-icon">
        <Gift size={30} />
      </span>
      <div>
        <h2>{reward.title}</h2>
        <p className="metadata">{uk.rewardTypes[reward.type]}</p>
      </div>
      {reward.description && <p className="workflow-description">{reward.description}</p>}
      <div className="badge-row">
        <span className="points-pill">
          <Star size={16} />
          {reward.cost} {uk.points}
        </span>
        {parent && (
          <span className={`status-chip ${reward.isActive ? '' : 'subdued'}`}>
            {reward.isActive ? uk.active : uk.inactive}
          </span>
        )}
      </div>
      {parent ? (
        <div className="workflow-actions">
          <button className="button tonal" onClick={edit}>
            {uk.edit}
          </button>
          {remove}
        </div>
      ) : (
        <>
          <Feedback
            error={mutation.error}
            success={mutation.isSuccess ? uk.rewardRequested : undefined}
          />
          <button
            className="button primary"
            disabled={!online || mutation.isPending || !requestReady || !affordable || pending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? uk.wait
              : !requestReady
                ? uk.loading
                : pending
                  ? uk.rewardStates.PENDING
                  : !affordable
                    ? uk.insufficientPoints
                    : uk.requestReward}
          </button>
        </>
      )}
    </article>
  );
}
