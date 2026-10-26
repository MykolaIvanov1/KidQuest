CREATE TABLE "TaskScheduleVersion" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "isRequired" BOOLEAN NOT NULL,
    "repeatDaily" BOOLEAN NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskScheduleVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskScheduleVersion_taskId_familyId_fkey" FOREIGN KEY ("taskId", "familyId") REFERENCES "Task"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskScheduleVersion_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskScheduleVersion_date_range_order" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate")
);
CREATE UNIQUE INDEX "TaskScheduleVersion_taskId_effectiveFrom_key" ON "TaskScheduleVersion"("taskId", "effectiveFrom");
CREATE INDEX "TaskScheduleVersion_familyId_effectiveFrom_idx" ON "TaskScheduleVersion"("familyId", "effectiveFrom");

-- Earlier schedule edits cannot be reconstructed. Start reliable tracking today;
-- existing completions remain available as factual history before that date.
INSERT INTO "TaskScheduleVersion" ("id", "taskId", "familyId", "effectiveFrom", "title", "isRequired", "repeatDaily", "isActive", "startDate", "endDate")
SELECT gen_random_uuid(), task."id", task."familyId", (CURRENT_TIMESTAMP AT TIME ZONE family."timeZone")::date,
       task."title", task."isRequired", task."repeatDaily", (task."isActive" AND task."deletedAt" IS NULL), task."startDate", task."endDate"
FROM "Task" task JOIN "Family" family ON family."id" = task."familyId";

-- The public achievement catalog is available without running credential-based seed.
INSERT INTO "Achievement" ("id", "code", "title", "description", "icon", "configuration", "isActive", "createdAt", "updatedAt") VALUES
(gen_random_uuid(), 'STREAK_7', 'Тиждень пригод', 'Виконуй обов’язкові завдання 7 днів поспіль.', 'Flame', '{"type":"STREAK","target":7}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
(gen_random_uuid(), 'TASKS_30', '30 добрих справ', 'Отримай підтвердження 30 виконаних завдань.', 'CheckCircle2', '{"type":"APPROVED_TASKS","target":30}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
(gen_random_uuid(), 'POINTS_100', 'Перші 100 балів', 'Зароби 100 балів за підтверджені завдання.', 'Star', '{"type":"EARNED_POINTS","target":100}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
(gen_random_uuid(), 'POINTS_500', '500 балів', 'Зароби 500 балів за підтверджені завдання.', 'Trophy', '{"type":"EARNED_POINTS","target":500}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
