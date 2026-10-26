import type { AiAdvice, AiIntent, AiRequest, Role } from '@kidquest/types';
import type { UserRecord } from '../auth/auth.types.js';

/** Provider input contains aggregates and explicitly selected, untrusted task text only. */
export interface AiContext {
  role: Role;
  intent: AiIntent;
  locale: 'uk-UA';
  childPresent: boolean;
  progress: {
    availableTasks: number;
    approvedToday: number;
    awaitingReview: number;
    approvedTotal: number;
    earnedPoints: number;
    balance: number;
    availableRewards: number;
    earnedAchievements: number;
  };
  task?: { title: string; description: string; photoRequired: boolean; points: number };
}
export interface ProviderAdvice {
  message: string;
  tips: string[];
}
export interface AiProvider {
  generate(context: AiContext, signal: AbortSignal): Promise<ProviderAdvice>;
}
export interface AiOptions {
  provider?: AiProvider | null;
  timeoutMs?: number;
  now?: () => Date;
}
export interface AiContextRepository {
  context(user: UserRecord, input: AiRequest): Promise<AiContext>;
}
export type { AiAdvice, AiIntent, AiRequest };
