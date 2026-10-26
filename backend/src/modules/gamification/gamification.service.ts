import type { Prisma } from '@prisma/client';
import type {
  AchievementDto,
  AchievementsData,
  CalendarData,
  GamificationSummary,
  ProgressData,
} from '@kidquest/types';
import type { UserRecord } from '../auth/auth.types.js';
import { buildDay, calculateStreak, monthDates } from './gamification.calculation.js';
import {
  GamificationRepository,
  type GamificationContext,
  type GamificationDatabase,
} from './gamification.repository.js';
import type { CalendarFilters } from './gamification.validation.js';

function condition(
  value: Prisma.JsonValue,
): { type: AchievementDto['type']; target: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { type, target } = value;
  if (
    (type !== 'STREAK' && type !== 'APPROVED_TASKS' && type !== 'EARNED_POINTS') ||
    typeof target !== 'number' ||
    !Number.isSafeInteger(target) ||
    target <= 0
  )
    return null;
  return { type, target };
}

async function reconcile(repository: GamificationRepository, context: GamificationContext) {
  const streak = calculateStreak(context.history);
  const definitions = await repository.definitions();
  const rows: Omit<AchievementDto, 'earnedAt'>[] = [];
  for (const definition of definitions) {
    const config = condition(definition.configuration);
    if (!config) continue;
    const progress =
      config.type === 'STREAK'
        ? streak.bestStreak
        : config.type === 'APPROVED_TASKS'
          ? context.approvedTasks
          : context.earnedPoints;
    rows.push({
      id: definition.id,
      code: definition.code,
      title: definition.title,
      description: definition.description,
      icon: definition.icon,
      type: config.type,
      target: config.target,
      progress: Math.min(config.target, progress),
    });
  }
  if (context.child) {
    const eligible = rows.filter((row) => row.progress >= row.target).map((row) => row.id);
    if (eligible.length) await repository.award(context.child.userId, eligible);
  }
  const earned = context.child ? await repository.earned(context.child.userId) : [];
  const earnedById = new Map(earned.map((row) => [row.achievementId, row.earnedAt.toISOString()]));
  const achievements: AchievementDto[] = rows.map((row) => ({
    ...row,
    earnedAt: earnedById.get(row.id) ?? null,
  }));
  const nextAchievement =
    [...achievements]
      .filter((row) => !row.earnedAt)
      .sort(
        (left, right) =>
          right.progress / right.target - left.progress / left.target ||
          left.target - right.target ||
          left.code.localeCompare(right.code),
      )[0] ?? null;
  const summary: GamificationSummary = {
    childId: context.child?.id ?? null,
    timeZone: context.family.timeZone,
    today: context.history.today,
    trackingFrom: context.history.trackingFrom,
    ...streak,
    approvedTasks: context.approvedTasks,
    earnedPoints: context.earnedPoints,
    nextAchievement: context.child ? nextAchievement : null,
  };
  return { achievements, summary };
}

function childDto(context: GamificationContext) {
  return context.child ? { id: context.child.id, firstName: context.child.firstName } : null;
}

function calendarData(context: GamificationContext, month?: string): CalendarData {
  const selectedMonth = month ?? context.history.today.slice(0, 7);
  const days = monthDates(selectedMonth).map((date) => buildDay(date, context.history));
  return {
    child: childDto(context),
    timeZone: context.family.timeZone,
    today: context.history.today,
    month: selectedMonth,
    trackingFrom: context.history.trackingFrom,
    days,
    summary: {
      approved: days.reduce((sum, day) => sum + day.approved, 0),
      submitted: days.reduce((sum, day) => sum + day.submitted, 0),
      rejected: days.reduce((sum, day) => sum + day.rejected, 0),
      missed: days.reduce((sum, day) => sum + day.missed, 0),
      earnedPoints: days.reduce((sum, day) => sum + day.earnedPoints, 0),
      successfulDays: days.filter((day) => day.successful).length,
    },
  };
}

export async function evaluateAchievements(
  db: GamificationDatabase,
  familyId: string,
  childId: string,
) {
  const repository = new GamificationRepository(db);
  return reconcile(repository, await repository.history(familyId, childId));
}

export class GamificationService {
  private repository: GamificationRepository;
  constructor(db: GamificationDatabase) {
    this.repository = new GamificationRepository(db);
  }

  async summary(user: UserRecord, childId?: string): Promise<GamificationSummary> {
    return (await reconcile(this.repository, await this.repository.context(user, childId))).summary;
  }

  async achievements(user: UserRecord, childId?: string): Promise<AchievementsData> {
    const context = await this.repository.context(user, childId);
    return { child: childDto(context), ...(await reconcile(this.repository, context)) };
  }

  async calendar(user: UserRecord, filters: CalendarFilters = {}): Promise<CalendarData> {
    return calendarData(await this.repository.context(user, filters.childId), filters.month);
  }

  async progress(user: UserRecord, filters: CalendarFilters = {}): Promise<ProgressData> {
    const context = await this.repository.context(user, filters.childId);
    const { summary } = await reconcile(this.repository, context);
    return {
      ...calendarData(context, filters.month),
      streak: summary.streak,
      bestStreak: summary.bestStreak,
      lifetimeApprovedTasks: summary.approvedTasks,
      lifetimeEarnedPoints: summary.earnedPoints,
    };
  }
}
