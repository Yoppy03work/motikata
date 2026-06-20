-- Phase 14d: GoogleCalendar.accessRole 追加。
-- 既存行は NULL で開始 → 次回 sync で埋まる。
-- 書き込みパス (events.patch/insert/delete) は accessRole=="reader"/"freeBusyReader"
-- なら早期エラーで Google API を叩かない (rate limit 浪費 + 403 ループ防止)。

ALTER TABLE "GoogleCalendar" ADD COLUMN "accessRole" TEXT;
