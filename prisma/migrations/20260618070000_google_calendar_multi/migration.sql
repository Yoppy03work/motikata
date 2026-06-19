-- Phase 2: 多カレンダー + 色追従。
--
-- 構造:
--   - GoogleCalendar テーブル新設 (credential 1 行に対し N 行のカレンダー)
--   - TaskInstance に googleCalendarId (FK) + color (hex) を追加
--   - GoogleCredential.syncToken を撤去 (GoogleCalendar 側に移管)
--
-- 既存データへの影響:
--   - Phase 1 で 既に同期済みの GOOGLE TaskInstance は googleCalendarId が
--     NULL のまま残る。次回 sync で primary カレンダー行が GoogleCalendar に
--     登録された後、events.list の sourceExternalId マッチで自然と紐付け直
--     される (upsert 経路で googleCalendarId と color が埋まる)。
--   - GoogleCredential.syncToken は drop。これにより次回 sync で primary
--     カレンダーは syncToken なし → full sync (timeMin=now-30d) になる。
--     同期コストは 1 回限りで許容。

-- GoogleCalendar 新設
CREATE TABLE "GoogleCalendar" (
  "id"            SERIAL PRIMARY KEY,
  "credentialId"  INTEGER NOT NULL,
  "externalId"    TEXT NOT NULL,
  "summary"       TEXT NOT NULL,
  "isPrimary"     BOOLEAN NOT NULL DEFAULT false,
  "colorId"       TEXT,
  "colorHex"      TEXT,
  "enabled"       BOOLEAN NOT NULL DEFAULT true,
  "syncToken"     TEXT,
  "lastSyncAt"    TIMESTAMP(3),
  "lastError"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleCalendar_credentialId_fkey"
    FOREIGN KEY ("credentialId") REFERENCES "GoogleCredential"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoogleCalendar_credentialId_externalId_key"
  ON "GoogleCalendar"("credentialId", "externalId");

-- TaskInstance への列追加
ALTER TABLE "TaskInstance"
  ADD COLUMN "googleCalendarId" INTEGER,
  ADD COLUMN "color"            TEXT;

ALTER TABLE "TaskInstance"
  ADD CONSTRAINT "TaskInstance_googleCalendarId_fkey"
    FOREIGN KEY ("googleCalendarId") REFERENCES "GoogleCalendar"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- GoogleCredential.syncToken を撤去 (Phase 2 で GoogleCalendar 側に移管)
ALTER TABLE "GoogleCredential" DROP COLUMN "syncToken";
