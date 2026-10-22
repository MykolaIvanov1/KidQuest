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
