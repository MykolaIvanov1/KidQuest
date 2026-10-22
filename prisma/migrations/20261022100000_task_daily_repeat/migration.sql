-- Existing tasks already recur daily; preserve that behavior for all stored rows.
ALTER TABLE "Task"
ADD COLUMN "repeatDaily" BOOLEAN NOT NULL DEFAULT true;
