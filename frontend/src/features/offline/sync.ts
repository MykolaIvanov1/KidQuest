import type { PublicUser, CompletionDto } from '@kidquest/types';
import { uk } from '../../lib/i18n';
import {
  api,
  ApiError,
  isConnectionFailure,
  currentAuthVersion,
  expireApiSession,
  isApiSession,
} from '../../services/api';
import { offlineStore, type OfflineStore, type OfflineOwner } from './store';

export interface SyncDependencies {
  store: OfflineStore;
  verify: () => Promise<PublicUser>;
  send: (taskId: string, body: FormData, signal: AbortSignal) => Promise<CompletionDto>;
  now: () => number;
  onSuccess: (completion: CompletionDto) => Promise<void>;
}
export class OfflineSync {
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private stopped = false;
  constructor(
    private owner: OfflineOwner,
    private dependencies: SyncDependencies,
  ) {}
  stop() {
    this.stopped = true;
    this.controller?.abort();
  }
  run(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async drain() {
    if (this.stopped) return;
    if (
      !(await this.dependencies.store.list(this.owner.sessionId)).some(
        (item) => item.status !== 'FAILED',
      )
    )
      return;
    // Cookie refresh in another tab must never send this owner's work under a different identity.
    const current = await this.dependencies.verify();
    if (
      this.stopped ||
      current.id !== this.owner.user.id ||
      current.familyId !== this.owner.user.familyId ||
      current.role !== 'CHILD'
    )
      return;
    for (let count = 0; count < 50 && !this.stopped; count += 1) {
      const lease = crypto.randomUUID();
      const operation = await this.dependencies.store.claim(
        this.owner.sessionId,
        lease,
        this.dependencies.now(),
      );
      if (!operation || this.stopped) return;
      this.controller = new AbortController();
      const timeout = setTimeout(() => this.controller?.abort(), 90_000);
      try {
        const form = new FormData();
        form.set('operationId', operation.operationId);
        form.set('completedAt', operation.completedAt);
        form.set('taskVersion', operation.taskVersion);
        for (const photo of operation.photos) {
          const blob = photo.bytes ? new Blob([photo.bytes], { type: photo.type }) : photo.blob;
          form.append('photos', blob, photo.name);
        }
        const result = await this.dependencies.send(operation.taskId, form, this.controller.signal);
        if (this.stopped) return;
        if (await this.dependencies.store.ack(this.owner.sessionId, operation.operationId, lease))
          await this.dependencies.onSuccess(result);
      } catch (error) {
        if (this.stopped) return;
        const transient =
          isConnectionFailure(error) ||
          !(error instanceof ApiError) ||
          error.code === 'CONCURRENT_UPDATE';
        const retryAt = transient
          ? this.dependencies.now() +
            Math.min(300_000, 2_000 * 2 ** Math.min(operation.attempts - 1, 8))
          : null;
        await this.dependencies.store.fail(this.owner.sessionId, operation.operationId, lease, {
          code: error instanceof ApiError ? error.code : 'NETWORK_ERROR',
          message: error instanceof ApiError ? error.message : uk.offlineSendError,
          retryAt,
        });
        // Authentication needs the owner to log in again; don't spin on a revoked session.
        if (
          transient ||
          (error instanceof ApiError &&
            (error.status === 401 || error.status === 403 || error.code === 'SESSION_CHANGED'))
        )
          return;
      } finally {
        clearTimeout(timeout);
        this.controller = null;
      }
    }
  }
}
export function createOfflineSync(owner: OfflineOwner, onSuccess: SyncDependencies['onSuccess']) {
  return new OfflineSync(owner, {
    store: offlineStore,
    verify: async () => {
      const user = await api<PublicUser>('/me');
      if (currentAuthVersion() !== owner.authVersion) throw expireApiSession();
      return user;
    },
    send: (id, body, signal) => {
      if (!isApiSession(owner.user.id, owner.authVersion))
        throw new ApiError(409, 'SESSION_CHANGED', uk.authLost);
      return api<CompletionDto>(`/tasks/${id}/submit`, { method: 'POST', body, signal });
    },
    now: Date.now,
    onSuccess,
  });
}
