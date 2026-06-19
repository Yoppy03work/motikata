-- Phase 13: TaskInstance に endAt / isAllDay を追加。
--
-- 目的:
--   - Google カレンダー由来の multi-day all-day event を 1 日に collapse させずに保持
--   - 通常 event の duration (start - end) を復元できるようにする
--   - all-day vs timed の明示フラグ (00:00 heuristic を排除)
--
-- 互換性:
--   - 既存行は endAt=NULL / isAllDay=false で開始
--   - dueAt 単独運用 (今までの挙動) は endAt NULL のままで動作継続
--   - Google 由来は次回 sync で events.list が end.date/end.dateTime を返した時点で埋まる
--
-- 既存の挙動に影響:
--   - 通知/今日ビュー/カレンダー表示はすべて dueAt を読むので、endAt 追加だけでは
--     見た目変化なし。Google write-back (events.patch/insert) と sync 取り込みが
--     端的に「正しい end を保持する」だけになる。

ALTER TABLE "TaskInstance"
  ADD COLUMN "endAt"     TIMESTAMP(3),
  ADD COLUMN "isAllDay"  BOOLEAN NOT NULL DEFAULT false;
