-- AlterTable
ALTER TABLE "ClassSchedule" ADD COLUMN "endPeriod" INTEGER NOT NULL DEFAULT 1;
-- 既存データは endPeriod = period に揃える(初期値は 1 だが、既存行があれば period に上書き)
UPDATE "ClassSchedule" SET "endPeriod" = "period";
