// Phase 14e: Slack 健全性アラートのメッセージ組み立て (テスタブル分離)。
//
// 各 source の最新 lastError をリスト化して 1 通の Slack message にする。
// 件数が多い場合の truncate (Slack の payload 上限) は max 10 件で打ち切り、
// 末尾に「他 N 件」を付ける。

import { formatInTimeZone } from "date-fns-tz";
import { APP_TZ } from "./tz";
import type { SlackMessage } from "./slack";

export type HealthAlertEntry = {
  source: string;
  detail: string;
  lastAt: Date | null;
};

const MAX_ENTRIES = 10;
const MAX_DETAIL_CHARS = 200;

export function buildHealthAlertMessage(
  entries: HealthAlertEntry[],
): SlackMessage {
  const shown = entries.slice(0, MAX_ENTRIES);
  const omitted = Math.max(0, entries.length - MAX_ENTRIES);
  const lines = shown.map((e) => {
    const at = e.lastAt
      ? formatInTimeZone(e.lastAt, APP_TZ, "yyyy-MM-dd HH:mm")
      : "未実行";
    const detail = (e.detail || "(不明)").slice(0, MAX_DETAIL_CHARS);
    return `- [${e.source}] 最終: ${at} / エラー: ${detail}`;
  });
  if (omitted > 0) lines.push(`...他 ${omitted} 件`);
  const text = [
    `[モチカタ] 同期エラー ${entries.length} 件があります`,
    "",
    ...lines,
  ].join("\n");
  return { text };
}
