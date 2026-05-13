-- ClassSchedule の出所を明示する列。
-- null = 手動追加、"cit-portal" = CITポータル同期由来。
-- 既存の手動追加行は null のまま、CIT 同期で書かれた行は次回同期で
-- importedFrom='cit-portal' が入る(本マイグレーション自体は既存行を変更しない)。

ALTER TABLE "ClassSchedule" ADD COLUMN "importedFrom" TEXT;
CREATE INDEX "ClassSchedule_importedFrom_idx" ON "ClassSchedule"("importedFrom");
