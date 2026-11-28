-- R-3258 X6 undo (28 Nov 2026): reverses 20261128_x6_access_request.sql exactly.
-- Run ONLY after the pre-X6 code is deployed again (the X6 client reads "AccessRequest").
-- Drops every ask: export first if they must be kept
--   (psql -c "\copy \"AccessRequest\" to 'accessrequest-<date>.csv' csv header").
-- Grants given by approving an ask are ordinary AppAccess rows with AccessAudit rows: they stay.
-- Run with: psql --single-transaction -v ON_ERROR_STOP=1 -f 20261128_x6_access_request.down.sql

SET lock_timeout = '5s';

DROP INDEX IF EXISTS "AccessRequest_userId_grantId_createdAt_idx";
DROP INDEX IF EXISTS "AccessRequest_state_createdAt_idx";
DROP INDEX IF EXISTS "AccessRequest_openKey_key";

DROP TABLE IF EXISTS "AccessRequest";
