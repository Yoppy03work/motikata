-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('TASK', 'EVENT');

-- AlterTable
ALTER TABLE "TaskInstance" ADD COLUMN     "itemType" "ItemType" NOT NULL DEFAULT 'TASK',
ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TaskTemplate" ADD COLUMN     "itemType" "ItemType" NOT NULL DEFAULT 'TASK',
ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT true;
