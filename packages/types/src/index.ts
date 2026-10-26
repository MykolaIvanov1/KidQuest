export type Role = 'PARENT' | 'CHILD';
export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  role: Role;
  familyId: string;
}
export interface AuthSession {
  accessToken: string;
  user: PublicUser;
}
export interface AccountProfileData {
  user: PublicUser;
  family: { id: string; name: string; timeZone: string };
  childId: string | null;
  createdAt: string;
}
export interface AccountMutationData {
  updated: boolean;
  reauthenticate: boolean;
}
export interface LoginLogDto {
  id: string;
  user: PublicUser;
  loginAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  device: string | null;
  success: boolean;
}
export interface LoginJournalData {
  items: LoginLogDto[];
  nextCursor: string | null;
}
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: unknown[] } };
export interface DashboardData {
  family: { id: string; name: string; timeZone: string };
  child: { id: string; firstName: string } | null;
  counts: {
    children: number;
    activeTasks: number;
    activeRewards: number;
    pendingCompletions: number;
    pendingRewards: number;
  };
  balance: number;
  tasks: {
    id: string;
    title: string;
    description: string | null;
    points: number;
    photoRequired: boolean;
    category: string | null;
  }[];
  rewards: { id: string; title: string; description: string | null; cost: number; type: string }[];
  today: { approved: number; total: number };
  streak: number | null;
  gamification?: GamificationSummary;
}

export interface AchievementDto {
  id: string;
  code: string;
  title: string;
  description: string;
  icon: string;
  type: 'STREAK' | 'APPROVED_TASKS' | 'EARNED_POINTS';
  target: number;
  progress: number;
  earnedAt: string | null;
}
export interface GamificationSummary {
  childId: string | null;
  timeZone: string;
  today: string;
  trackingFrom: string | null;
  streak: number;
  bestStreak: number;
  approvedTasks: number;
  earnedPoints: number;
  nextAchievement: AchievementDto | null;
}
export interface AchievementsData {
  child: { id: string; firstName: string } | null;
  summary: GamificationSummary;
  achievements: AchievementDto[];
}
export interface CalendarTaskDto {
  taskId: string;
  title: string;
  isRequired: boolean;
  status: CompletionStatus;
  completionId: string | null;
  points: number;
}
export interface CalendarDayDto {
  date: string;
  status: 'COMPLETE' | 'PARTIAL' | 'PENDING' | 'MISSED' | 'EMPTY' | 'FUTURE';
  expected: number;
  required: number;
  approved: number;
  submitted: number;
  rejected: number;
  missed: number;
  earnedPoints: number;
  successful: boolean;
  tasks: CalendarTaskDto[];
}
export interface CalendarData {
  child: { id: string; firstName: string } | null;
  timeZone: string;
  today: string;
  month: string;
  trackingFrom: string | null;
  days: CalendarDayDto[];
  summary: {
    approved: number;
    submitted: number;
    rejected: number;
    missed: number;
    earnedPoints: number;
    successfulDays: number;
  };
}
export interface ProgressData extends CalendarData {
  streak: number;
  bestStreak: number;
  lifetimeApprovedTasks: number;
  lifetimeEarnedPoints: number;
}

export type CompletionStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'MISSED';
export type RewardRequestStatus = 'PENDING' | 'APPROVED' | 'ISSUED' | 'REJECTED';
export type RewardType = 'SCREEN_TIME' | 'FOOD' | 'TV' | 'ACTIVITY' | 'MATERIAL' | 'OTHER';
export type PointTransactionType =
  'TASK_REWARD' | 'BONUS' | 'PENALTY' | 'REWARD_PURCHASE' | 'ADMIN_ADJUSTMENT';
export interface TaskCategoryDto {
  id: string;
  name: string;
  icon: string;
  color: string;
}
export interface TaskPhotoDto {
  id: string;
  url: string;
  mimeType: string;
  size: number;
}
export interface TaskCompletionDto {
  id: string;
  taskId: string;
  childId: string;
  childName: string;
  taskTitle: string;
  status: CompletionStatus;
  completionDate: string;
  pointsSnapshot: number;
  operationId: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  photos: TaskPhotoDto[];
}
export interface TaskDto {
  id: string;
  updatedAt: string;
  title: string;
  description: string;
  categoryId: string;
  category: TaskCategoryDto;
  icon: string;
  color: string;
  points: number;
  isRequired: boolean;
  repeatDaily: boolean;
  photoRequired: boolean;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isActive: boolean;
  todayCompletion: TaskCompletionDto | null;
}
export interface RewardDto {
  id: string;
  title: string;
  description: string;
  icon: string;
  imageUrl: string | null;
  cost: number;
  type: RewardType;
  isActive: boolean;
  createdAt: string;
}
export interface RewardRequestDto {
  id: string;
  rewardId: string;
  rewardTitle: string;
  childId: string;
  childName: string;
  status: RewardRequestStatus;
  costSnapshot: number;
  operationId: string;
  reviewedAt: string | null;
  issuedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}
export interface PointsData {
  childId: string | null;
  balance: number;
}
export interface PointTransactionDto {
  id: string;
  childId: string;
  type: PointTransactionType;
  amount: number;
  description: string;
  createdAt: string;
}
export type CompletionDto = TaskCompletionDto;
export type CategoryDto = TaskCategoryDto;
export type PhotoDto = TaskPhotoDto;
export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  path: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsData {
  items: NotificationDto[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface NotificationStatusData {
  pushConfigured: boolean;
}

export interface DeviceDto {
  id: string;
  name: string | null;
  platform: string | null;
  lastSeenAt: string;
}

export type AiIntent =
  'GREETING' | 'MOTIVATE' | 'PRAISE' | 'TASK_HELP' | 'PROGRESS' | 'QUEST_IDEAS' | 'REWARD_IDEAS';
export interface AiRequest {
  intent: AiIntent;
  taskId?: string;
  childId?: string;
}
export interface AiAdvice {
  intent: AiIntent;
  message: string;
  tips: string[];
  source: 'LOCAL' | 'AI';
  reason: 'LOCAL_MODE' | 'PROVIDER_UNAVAILABLE' | null;
  generatedAt: string;
}
