-- R-3258 X6 (28 Nov 2026): "Ask for access" requests. Additive only (1 new table, no change to existing tables).
-- Same shape as `prisma migrate diff` writes for the AccessRequest model in prisma/schema.prisma.
-- Apply BEFORE deploying the X6 code (the new client reads "AccessRequest"); the X3 code ignores the table, so it can
-- go in with X3 or any time before X6. Undo: 20261128_x6_access_request.down.sql.
-- Run with psql --single-transaction -v ON_ERROR_STOP=1: lock_timeout makes it give up after 5 s instead of queueing.

SET lock_timeout = '5s';

-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "reason" TEXT,
    "state" TEXT NOT NULL DEFAULT 'open',
    "openKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decidedByName" TEXT,
    "decisionNote" TEXT,
    "changeId" TEXT,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessRequest_openKey_key" ON "AccessRequest"("openKey");

-- CreateIndex
CREATE INDEX "AccessRequest_state_createdAt_idx" ON "AccessRequest"("state", "createdAt");

-- CreateIndex
CREATE INDEX "AccessRequest_userId_grantId_createdAt_idx" ON "AccessRequest"("userId", "grantId", "createdAt");
