-- Phase 6: 衝突解決の正式版。
--
-- 追加:
--   - TaskInstance.googleEtag / googleUpdatedAt (Google からの etag/updated を保持)
--   - GoogleTombstone (ローカル削除した GOOGLE 由来 event の墓標)
--
-- 既存データへの影響:
--   - 全 TaskInstance.googleEtag / googleUpdatedAt は NULL で開始。次回 sync で
--     events.list が返してくる etag / updated を順次焼き込んでいく。NULL の
--     ままなら events.patch 時に If-Match を送らない (= 衝突検出は無効) という
--     graceful degradation で動かす。
--   - GoogleTombstone は新規。既存の削除済み event は墓標を持たないが、
--     その分は次回 sync で events.list が「cancelled」を返してくれるので、
--     既存のロジックで自然に SKIPPED 化される (実害なし)。

ALTER TABLE "TaskInstance"
  ADD COLUMN "googleEtag"       TEXT,
  ADD COLUMN "googleUpdatedAt"  TIMESTAMP(3);

CREATE TABLE "GoogleTombstone" (
  "id"                SERIAL PRIMARY KEY,
  "googleCalendarId"  INTEGER NOT NULL,
  "externalEventId"   TEXT NOT NULL,
  "deletedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleTombstone_googleCalendarId_fkey"
    FOREIGN KEY ("googleCalendarId") REFERENCES "GoogleCalendar"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GoogleTombstone_googleCalendarId_externalEventId_key"
  ON "GoogleTombstone"("googleCalendarId", "externalEventId");

CREATE INDEX "GoogleTombstone_expiresAt_idx" ON "GoogleTombstone"("expiresAt");
