-- 外部ソース由来の重複行を防ぐため (source, sourceExternalId) に一意制約を張る。
-- 既存に重複行がある場合は「業務的に残すべき側」だけ残してから index を作る。
-- Postgres の NULL=distinct 規約により MANUAL タスク(sourceExternalId IS NULL)は
-- 複数行存在しても制約に違反しない。
--
-- 残す側の優先順位 (大きいタプルが残る = 小さい方を DELETE):
--   1. status が OPEN でない方 (DONE/SKIPPED の完了履歴は消えると痛い)
--   2. updatedAt が新しい方 (最新の状態)
--   3. id が大きい方 (最終タイブレーカ)
--
-- 旧コードは単に id が小さい方を一律削除していたため、
-- 過去に手で完了したタスクの隣に sync で OPEN な重複行が出来ていた
-- ケースで、完了履歴を消して未完了側を残す事故が起きうる。
--
-- タプル比較 (a,b,c) > (d,e,f) は Postgres で辞書順比較になる。

DELETE FROM "TaskInstance" t1
USING "TaskInstance" t2
WHERE t1.id <> t2.id
  AND t1."source" = t2."source"
  AND t1."sourceExternalId" IS NOT NULL
  AND t1."sourceExternalId" = t2."sourceExternalId"
  AND (
    -- t2 が「より残すべき」なら t1 を削除する。
    -- OPEN ではない側 (DONE/SKIPPED) を優先するため CASE で 1 > 0。
    (CASE WHEN t2."status" = 'OPEN' THEN 0 ELSE 1 END, t2."updatedAt", t2.id)
    >
    (CASE WHEN t1."status" = 'OPEN' THEN 0 ELSE 1 END, t1."updatedAt", t1.id)
  );

-- 一意インデックス作成。
CREATE UNIQUE INDEX "TaskInstance_source_sourceExternalId_key"
ON "TaskInstance"("source", "sourceExternalId");
