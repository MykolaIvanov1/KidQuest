-- Add optional, inclusive calendar boundaries without changing existing tasks.
ALTER TABLE "Task"
ADD COLUMN "startDate" DATE,
ADD COLUMN "endDate" DATE;

ALTER TABLE "Task"
ADD CONSTRAINT "Task_date_range_order"
CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate");
