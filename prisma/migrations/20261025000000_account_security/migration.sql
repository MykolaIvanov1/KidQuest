-- Security changes invalidate access tokens and refresh sessions together.
ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RefreshToken" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_authVersion_nonnegative" CHECK ("authVersion" >= 0);
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_authVersion_nonnegative" CHECK ("authVersion" >= 0);
CREATE INDEX "LoginLog_userId_loginAt_id_idx" ON "LoginLog" ("userId", "loginAt", "id");