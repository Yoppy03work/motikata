-- dispatcher 排他用の claim タイムスタンプ。
-- 配信実行中のクラッシュ/タイムアウトで attempts を消費せず、
-- stale (>5分) になれば再 claim 可能にして自動回復する。
ALTER TABLE "Reminder" ADD COLUMN "claimedAt" TIMESTAMP(3);
