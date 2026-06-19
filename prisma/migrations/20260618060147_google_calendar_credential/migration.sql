-- TaskSource enum に GOOGLE を追加。
-- 既存行は影響なし(列値が増えるだけ)。
ALTER TYPE "TaskSource" ADD VALUE 'GOOGLE';

-- Google カレンダー連携用の OAuth 2.0 認証情報(単一ユーザー前提なので 1 行のみ)。
CREATE TABLE "GoogleCredential" (
  "id"                   SERIAL PRIMARY KEY,
  "singletonKey"         TEXT NOT NULL DEFAULT 'default',
  "email"                TEXT NOT NULL,
  "refreshTokenEnc"      TEXT NOT NULL,
  "accessToken"          TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "scope"                TEXT NOT NULL,
  "syncToken"            TEXT,
  "lastSyncAt"           TIMESTAMP(3),
  "lastError"            TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL
);

-- 並行 save での重複行を防ぐため singletonKey で一意制約。upsert で使う。
CREATE UNIQUE INDEX "GoogleCredential_singletonKey_key" ON "GoogleCredential"("singletonKey");
