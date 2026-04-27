-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('INBOX', 'DIARY');

-- CreateTable
CREATE TABLE "Note" (
    "id" SERIAL NOT NULL,
    "body" TEXT NOT NULL,
    "kind" "NoteKind" NOT NULL DEFAULT 'INBOX',
    "diaryDate" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "promotedTaskId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Note_kind_archivedAt_createdAt_idx" ON "Note"("kind", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Note_diaryDate_idx" ON "Note"("diaryDate");
