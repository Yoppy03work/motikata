-- 外部ソース由来の重複行を防ぐため (source, sourceExternalId) に一意制約を張る。
-- 既存に重複行がある場合は最新の id だけ残してクリーンアップしてから index を作る。
-- Postgres の NULL=distinct 規約により MANUAL タスク(sourceExternalId IS NULL)は
-- 複数行存在しても制約に違反しない。

-- Step 1: 重複行(同じ source + sourceExternalId)があれば古い id 側を削除。
DELETE FROM "TaskInstance" t1
USING "TaskInstance" t2
WHERE t1.id < t2.id
  AND t1."source" = t2."source"
  AND t1."sourceExternalId" IS NOT NULL
  AND t1."sourceExternalId" = t2."sourceExternalId";

-- Step 2: 一意インデックス作成。
CREATE UNIQUE INDEX "TaskInstance_source_sourceExternalId_key"
ON "TaskInstance"("source", "sourceExternalId");
