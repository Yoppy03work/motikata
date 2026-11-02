-- AlterEnum
ALTER TYPE "ReminderChannel" ADD VALUE 'DISCORD';
ALTER TYPE "ReminderChannel" ADD VALUE 'LINE';
ALTER TYPE "ReminderChannel" ADD VALUE 'ALL';

-- CreateTable
CREATE TABLE "NotifyChannel" (
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "configEnc" TEXT NOT NULL,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotifyChannel_pkey" PRIMARY KEY ("kind")
);
