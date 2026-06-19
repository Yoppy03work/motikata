-- CreateTable
CREATE TABLE "ClassDay" (
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassDay_pkey" PRIMARY KEY ("date")
);
