-- ユーザ指定のカード色 (hex like "#0ea5e9")。null は科目名ハッシュで自動配色。
ALTER TABLE "ClassSchedule" ADD COLUMN "color" TEXT;
