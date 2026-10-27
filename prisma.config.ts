import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // prisma/config の env() は未設定だと throw し、DB 接続不要な
    // `prisma generate` (CI / Docker build) まで落ちるので process.env を直接読む。
    url: process.env.DATABASE_URL ?? "",
  },
});
