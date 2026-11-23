SELECT pg_catalog.set_config('search_path', 'public', false);
UPDATE "User" u SET email = 'user' || r.n || '@example.test'
  FROM (SELECT id, row_number() OVER (ORDER BY "createdAt", id) n FROM "User") r WHERE r.id = u.id;
UPDATE "AppUserLink" l SET "externalEmail" = CASE WHEN l."externalEmail" IS NULL THEN NULL ELSE u.email END
  FROM "User" u WHERE u.id = l."userId";
UPDATE "AppUserLink" SET "externalEmail" = 'link' || id || '@example.test' WHERE "externalEmail" IS NOT NULL AND "externalEmail" NOT LIKE '%@example.test';
UPDATE "PendingAppAccess" SET email = 'pending' || id || '@example.test';
