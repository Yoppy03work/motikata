-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" SERIAL NOT NULL,
    "classScheduleId" INTEGER NOT NULL,
    "classDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorDetail" TEXT,

    CONSTRAINT "AttendanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceAuditLog" (
    "id" SERIAL NOT NULL,
    "classScheduleId" INTEGER,
    "classDate" TEXT,
    "method" TEXT,
    "phase" TEXT NOT NULL,
    "outcome" TEXT,
    "reason" TEXT,
    "jobId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceQrSession" (
    "id" SERIAL NOT NULL,
    "classScheduleId" INTEGER,
    "roomId" TEXT NOT NULL,
    "classDate" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceQrSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceLog_classDate_idx" ON "AttendanceLog"("classDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceLog_classScheduleId_classDate_method_key" ON "AttendanceLog"("classScheduleId", "classDate", "method");

-- CreateIndex
CREATE INDEX "AttendanceAuditLog_createdAt_idx" ON "AttendanceAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AttendanceAuditLog_classScheduleId_classDate_idx" ON "AttendanceAuditLog"("classScheduleId", "classDate");

-- CreateIndex
CREATE INDEX "AttendanceQrSession_expiresAt_idx" ON "AttendanceQrSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceQrSession_roomId_classDate_key" ON "AttendanceQrSession"("roomId", "classDate");

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_classScheduleId_fkey" FOREIGN KEY ("classScheduleId") REFERENCES "ClassSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAuditLog" ADD CONSTRAINT "AttendanceAuditLog_classScheduleId_fkey" FOREIGN KEY ("classScheduleId") REFERENCES "ClassSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceQrSession" ADD CONSTRAINT "AttendanceQrSession_classScheduleId_fkey" FOREIGN KEY ("classScheduleId") REFERENCES "ClassSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
