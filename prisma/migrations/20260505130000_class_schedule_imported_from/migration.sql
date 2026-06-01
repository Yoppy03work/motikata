-- ClassSchedule の出所を明示する列。
-- null = 手動追加、"cit-portal" = CITポータル同期由来。
--
-- 既存環境で CIT 同期が動いていた場合、これらの行は importedFrom=NULL のまま
-- 残ると後続の sync コードが「全部手動扱い」として保護対象にしてしまい、
-- 次回同期で新規行が二重作成される。
-- これを防ぐため、既存行のうち「CIT 同期由来らしい」ものを heuristic で
-- backfill する。判定根拠: 手動追加 API (/api/classes POST) は
-- effectiveFrom / effectiveTo を受け取らないので、これらが入っている行は
-- 同期由来とみなせる。

ALTER TABLE "ClassSchedule" ADD COLUMN "importedFrom" TEXT;

-- 既存の同期由来行を識別して採用 (adoption)。
UPDATE "ClassSchedule"
SET "importedFrom" = 'cit-portal'
WHERE "importedFrom" IS NULL
  AND ("effectiveFrom" IS NOT NULL OR "effectiveTo" IS NOT NULL);

CREATE INDEX "ClassSchedule_importedFrom_idx" ON "ClassSchedule"("importedFrom");
