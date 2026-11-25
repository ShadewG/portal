-- R-2159 M2 (25 Nov 2026): access admins, role presets, audit log. Additive only (1 column with a default, 2 new tables).
-- Generated: prisma migrate diff --from-schema <schema at 66fa718> --to-schema prisma/schema.prisma --script.
-- Applied ONLY to portal_dev on worker-3 (psql --single-transaction). Production keeps prisma db push; not applied there.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isAccessAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AccessRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "grantIds" TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessAudit" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "actorName" TEXT,
    "targetUserId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "oldState" TEXT NOT NULL,
    "newState" TEXT NOT NULL,
    "oldGrantedBy" TEXT,
    "oldGrantedAt" TIMESTAMP(3),
    "note" TEXT,
    "revertOf" TEXT,

    CONSTRAINT "AccessAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_name_key" ON "AccessRole"("name");

-- CreateIndex
CREATE INDEX "AccessAudit_changeId_idx" ON "AccessAudit"("changeId");

-- CreateIndex
CREATE INDEX "AccessAudit_targetUserId_at_idx" ON "AccessAudit"("targetUserId", "at");

-- CreateIndex
CREATE INDEX "AccessAudit_revertOf_idx" ON "AccessAudit"("revertOf");

