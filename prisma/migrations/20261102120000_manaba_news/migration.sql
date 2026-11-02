-- CreateTable
CREATE TABLE "ManabaNews" (
    "id" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "courseName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManabaNews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManabaNews_readAt_idx" ON "ManabaNews"("readAt");

-- CreateIndex
CREATE INDEX "ManabaNews_publishedAt_idx" ON "ManabaNews"("publishedAt");
