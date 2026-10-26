CREATE TYPE "PushDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

ALTER TABLE "Notification" ADD COLUMN "eventKey" VARCHAR(220);
ALTER TABLE "Device" ADD COLUMN "bindingVersion" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId", "eventKey");

CREATE TABLE "PushDelivery" (
  "id" UUID NOT NULL,
  "notificationId" UUID NOT NULL,
  "deviceId" UUID NOT NULL,
  "deviceVersion" INTEGER NOT NULL,
  "status" "PushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" UUID,
  "leaseUntil" TIMESTAMPTZ(3),
  "lastErrorCode" VARCHAR(80),
  "sentAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushDelivery_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "PushDelivery_deviceVersion_check" CHECK ("deviceVersion" >= 1),
  CONSTRAINT "PushDelivery_lease_check" CHECK (
    ("status" = 'PROCESSING' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)
    OR ("status" <> 'PROCESSING' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL)
  ),
  CONSTRAINT "PushDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PushDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PushDelivery_notificationId_deviceId_key" ON "PushDelivery"("notificationId", "deviceId");
CREATE INDEX "PushDelivery_status_nextAttemptAt_idx" ON "PushDelivery"("status", "nextAttemptAt");
CREATE INDEX "PushDelivery_status_leaseUntil_idx" ON "PushDelivery"("status", "leaseUntil");
CREATE INDEX "PushDelivery_deviceId_status_idx" ON "PushDelivery"("deviceId", "status");
