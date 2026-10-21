-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CHILD', 'PARENT');

-- CreateEnum
CREATE TYPE "TaskCompletionStatus" AS ENUM ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'MISSED');

-- CreateEnum
CREATE TYPE "PointTransactionType" AS ENUM ('TASK_REWARD', 'BONUS', 'PENALTY', 'REWARD_PURCHASE', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('SCREEN_TIME', 'FOOD', 'TV', 'ACTIVITY', 'MATERIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RewardRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'ISSUED', 'REJECTED');

-- CreateTable
CREATE TABLE "Family" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "timeZone" VARCHAR(80) NOT NULL DEFAULT 'Europe/Kyiv',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(100) NOT NULL,
    "firstName" VARCHAR(80) NOT NULL,
    "lastName" VARCHAR(80) NOT NULL DEFAULT '',
    "role" "Role" NOT NULL,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Child" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "firstName" VARCHAR(80) NOT NULL,
    "lastName" VARCHAR(80) NOT NULL DEFAULT '',
    "birthDate" DATE,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Child_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCategory" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "icon" VARCHAR(60) NOT NULL DEFAULT 'ListTodo',
    "color" VARCHAR(30) NOT NULL DEFAULT 'primary',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TaskCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" VARCHAR(60) NOT NULL DEFAULT 'ListTodo',
    "color" VARCHAR(30) NOT NULL DEFAULT 'primary',
    "points" INTEGER NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "photoRequired" BOOLEAN NOT NULL DEFAULT false,
    "startTime" VARCHAR(5),
    "endTime" VARCHAR(5),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCompletion" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "completionDate" DATE NOT NULL,
    "status" "TaskCompletionStatus" NOT NULL DEFAULT 'PENDING',
    "pointsSnapshot" INTEGER NOT NULL,
    "operationId" UUID,
    "submittedAt" TIMESTAMPTZ(3),
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedById" UUID,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TaskCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskPhoto" (
    "id" UUID NOT NULL,
    "completionId" UUID NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TaskPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "type" "PointTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "taskCompletionId" UUID,
    "rewardRequestId" UUID,
    "operationId" UUID NOT NULL,
    "reversalOfId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" VARCHAR(60) NOT NULL DEFAULT 'Gift',
    "imageUrl" TEXT,
    "cost" INTEGER NOT NULL,
    "type" "RewardType" NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRequest" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "rewardId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "status" "RewardRequestStatus" NOT NULL DEFAULT 'PENDING',
    "costSnapshot" INTEGER NOT NULL,
    "operationId" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "issuedById" UUID,
    "issuedAt" TIMESTAMPTZ(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RewardRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "icon" VARCHAR(60) NOT NULL DEFAULT 'Trophy',
    "configuration" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "achievementId" UUID NOT NULL,
    "earnedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "loginAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" VARCHAR(64),
    "userAgent" TEXT,
    "device" TEXT,
    "success" BOOLEAN NOT NULL,

    CONSTRAINT "LoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "userId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "sessionId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "replacedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "name" VARCHAR(120),
    "platform" VARCHAR(40),
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_familyId_role_deletedAt_idx" ON "User"("familyId", "role", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_familyId_key" ON "User"("id", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Child_userId_key" ON "Child"("userId");

-- CreateIndex
CREATE INDEX "Child_familyId_deletedAt_idx" ON "Child"("familyId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Child_id_familyId_key" ON "Child"("id", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Child_userId_familyId_key" ON "Child"("userId", "familyId");

-- CreateIndex
CREATE INDEX "TaskCategory_familyId_deletedAt_idx" ON "TaskCategory"("familyId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCategory_id_familyId_key" ON "TaskCategory"("id", "familyId");

-- CreateIndex
CREATE INDEX "Task_familyId_isActive_deletedAt_idx" ON "Task"("familyId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_categoryId_idx" ON "Task"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_familyId_key" ON "Task"("id", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCompletion_operationId_key" ON "TaskCompletion"("operationId");

-- CreateIndex
CREATE INDEX "TaskCompletion_familyId_status_deletedAt_idx" ON "TaskCompletion"("familyId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "TaskCompletion_childId_completionDate_idx" ON "TaskCompletion"("childId", "completionDate");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCompletion_id_familyId_key" ON "TaskCompletion"("id", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCompletion_taskId_childId_completionDate_key" ON "TaskCompletion"("taskId", "childId", "completionDate");

-- CreateIndex
CREATE INDEX "TaskPhoto_completionId_deletedAt_idx" ON "TaskPhoto"("completionId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_taskCompletionId_key" ON "PointTransaction"("taskCompletionId");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_rewardRequestId_key" ON "PointTransaction"("rewardRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_operationId_key" ON "PointTransaction"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_reversalOfId_key" ON "PointTransaction"("reversalOfId");

-- CreateIndex
CREATE INDEX "PointTransaction_familyId_childId_createdAt_idx" ON "PointTransaction"("familyId", "childId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_taskCompletionId_familyId_key" ON "PointTransaction"("taskCompletionId", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_rewardRequestId_familyId_key" ON "PointTransaction"("rewardRequestId", "familyId");

-- CreateIndex
CREATE INDEX "Reward_familyId_isActive_deletedAt_idx" ON "Reward"("familyId", "isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reward_id_familyId_key" ON "Reward"("id", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRequest_operationId_key" ON "RewardRequest"("operationId");

-- CreateIndex
CREATE INDEX "RewardRequest_familyId_status_deletedAt_idx" ON "RewardRequest"("familyId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "RewardRequest_childId_createdAt_idx" ON "RewardRequest"("childId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRequest_id_familyId_key" ON "RewardRequest"("id", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_code_key" ON "Achievement"("code");

-- CreateIndex
CREATE INDEX "Achievement_isActive_deletedAt_idx" ON "Achievement"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "UserAchievement_userId_earnedAt_idx" ON "UserAchievement"("userId", "earnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "LoginLog_userId_loginAt_idx" ON "LoginLog"("userId", "loginAt");

-- CreateIndex
CREATE INDEX "LoginLog_success_loginAt_idx" ON "LoginLog"("success", "loginAt");

-- CreateIndex
CREATE INDEX "AuditLog_familyId_createdAt_idx" ON "AuditLog"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_replacedById_key" ON "RefreshToken"("replacedById");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_token_key" ON "Device"("token");

-- CreateIndex
CREATE INDEX "Device_userId_deletedAt_idx" ON "Device"("userId", "deletedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Child" ADD CONSTRAINT "Child_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Child" ADD CONSTRAINT "Child_userId_familyId_fkey" FOREIGN KEY ("userId", "familyId") REFERENCES "User"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCategory" ADD CONSTRAINT "TaskCategory_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_categoryId_familyId_fkey" FOREIGN KEY ("categoryId", "familyId") REFERENCES "TaskCategory"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_taskId_familyId_fkey" FOREIGN KEY ("taskId", "familyId") REFERENCES "Task"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_childId_familyId_fkey" FOREIGN KEY ("childId", "familyId") REFERENCES "Child"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPhoto" ADD CONSTRAINT "TaskPhoto_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "TaskCompletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_childId_familyId_fkey" FOREIGN KEY ("childId", "familyId") REFERENCES "Child"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_taskCompletionId_familyId_fkey" FOREIGN KEY ("taskCompletionId", "familyId") REFERENCES "TaskCompletion"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_rewardRequestId_familyId_fkey" FOREIGN KEY ("rewardRequestId", "familyId") REFERENCES "RewardRequest"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "PointTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRequest" ADD CONSTRAINT "RewardRequest_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRequest" ADD CONSTRAINT "RewardRequest_rewardId_familyId_fkey" FOREIGN KEY ("rewardId", "familyId") REFERENCES "Reward"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRequest" ADD CONSTRAINT "RewardRequest_childId_familyId_fkey" FOREIGN KEY ("childId", "familyId") REFERENCES "Child"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRequest" ADD CONSTRAINT "RewardRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRequest" ADD CONSTRAINT "RewardRequest_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginLog" ADD CONSTRAINT "LoginLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "RefreshToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain constraints that Prisma's schema language cannot express.
ALTER TABLE "Task" ADD CONSTRAINT "Task_points_nonnegative" CHECK ("points" >= 0);
ALTER TABLE "Task" ADD CONSTRAINT "Task_time_format" CHECK (
  ("startTime" IS NULL OR "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND
  ("endTime" IS NULL OR "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_points_nonnegative" CHECK ("pointsSnapshot" >= 0);
ALTER TABLE "TaskPhoto" ADD CONSTRAINT "TaskPhoto_size_positive" CHECK ("size" > 0);
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_cost_nonnegative" CHECK ("cost" >= 0);
ALTER TABLE "RewardRequest" ADD CONSTRAINT "RewardRequest_cost_nonnegative" CHECK ("costSnapshot" >= 0);
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_amount_direction" CHECK (
  ("type" IN ('TASK_REWARD', 'BONUS') AND "amount" > 0) OR
  ("type" IN ('PENALTY', 'REWARD_PURCHASE') AND "amount" < 0) OR
  ("type" = 'ADMIN_ADJUSTMENT' AND "amount" <> 0)
);
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_no_self_reversal" CHECK ("reversalOfId" IS DISTINCT FROM "id");

CREATE FUNCTION protect_point_ledger() RETURNS trigger AS $ledger$
BEGIN
  RAISE EXCEPTION 'PointTransaction is append-only; record a compensating transaction instead'
    USING ERRCODE = '23514';
END;
$ledger$ LANGUAGE plpgsql;

CREATE TRIGGER point_ledger_append_only
BEFORE UPDATE OR DELETE ON "PointTransaction"
FOR EACH ROW EXECUTE FUNCTION protect_point_ledger();

