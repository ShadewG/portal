-- R-2159 M2 undo (25 Nov 2026): reverses 20261125_m2_access.sql exactly.
-- Run ONLY after the pre-M2 code is deployed again (the M2 client selects User.isAccessAdmin and would fail).
-- Drops the audit log and role presets: export them first if they must be kept
--   (psql -c "\copy \"AccessAudit\" to 'accessaudit-<date>.csv' csv header", same for "AccessRole").
-- AppAccess rows written through setGrants (incl. tab grants like pulse.hiring) are NOT removed: they are ordinary
-- AppAccess rows the pre-M2 code ignores (tab ids match no app). Remove them by hand if wanted.
-- Run with: psql --single-transaction -v ON_ERROR_STOP=1 -f 20261125_m2_access.down.sql

SET lock_timeout = '5s';

DROP INDEX IF EXISTS "AccessAudit_revertOf_idx";
DROP INDEX IF EXISTS "AccessAudit_targetUserId_at_idx";
DROP INDEX IF EXISTS "AccessAudit_changeId_idx";
DROP INDEX IF EXISTS "AccessRole_name_key";

DROP TABLE IF EXISTS "AccessAudit";
DROP TABLE IF EXISTS "AccessRole";

ALTER TABLE "User" DROP COLUMN IF EXISTS "isAccessAdmin";
