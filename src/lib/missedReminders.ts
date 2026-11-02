// アプリが止まっていた間(Mac のスリープ・Docker の停止など)に送れなかった通知の扱い。
//   - dispatch のたびに「最後に動いた時刻」を残し、間が空いていたら停止していたと判断する
//   - 予定時刻から LATE_MS 以上遅れたリマインダーは 1 件ずつ送らず、1 通にまとめて知らせる
//     (復帰した瞬間に何十件も届くと、どれが今大事なのか分からなくなるため)
// ここは DB を使わない純粋な関数だけ。

import { formatInTimeZone } from "date-fns-tz";
import type { NotifyMessage } from "@/lib/notifyConfig";
import { formatMinutes } from "@/lib/formatMinutes";
import { APP_TZ } from "@/lib/tz";

// dispatch は毎分動く。1 回の実行は最大 180 秒なので、10 分空いたら止まっていたと見なす。
export const OUTAGE_MIN_MS = 10 * 60_000;
// 予定時刻からこれ以上遅れたリマインダーは「止まっていて送れなかった」扱いにしてまとめる
export const LATE_MS = 10 * 60_000;
const MAX_LINES = 10;

export type Outage = { from: Date; to: Date };

export function detectOutage(lastBeat: Date | null, now: Date): Outage | null {
  if (!lastBeat) return null;
  return now.getTime() - lastBeat.getTime() >= OUTAGE_MIN_MS ? { from: lastBeat, to: now } : null;
}

export function isLate(remindAt: Date, now: Date): boolean {
  return now.getTime() - remindAt.getTime() >= LATE_MS;
}

export type MissedItem = {
  instanceId: number;
  title: string;
  dueAt: Date;
  // manaba の締切チェックが締切までに実行できなかった(提出したか分からない)
  deadlinePassed: boolean;
};

function fmt(d: Date, now: Date): string {
  const sameDay = formatInTimeZone(d, APP_TZ, "yyyyMMdd") === formatInTimeZone(now, APP_TZ, "yyyyMMdd");
  return formatInTimeZone(d, APP_TZ, sameDay ? "HH:mm" : "M/d HH:mm");
}

export function formatOutage(o: Outage, now: Date): string {
  const min = Math.round((o.to.getTime() - o.from.getTime()) / 60_000);
  return `${fmt(o.from, now)}〜${fmt(o.to, now)}(約 ${formatMinutes(min)})`;
}

/** 遅れた通知をまとめた 1 通。同じタスクのリマインダーが複数あっても 1 行にする。 */
export function buildMissedMessage(outage: Outage | null, items: MissedItem[], now: Date): NotifyMessage {
  const byTask = new Map<number, MissedItem>();
  for (const it of items) {
    const prev = byTask.get(it.instanceId);
    byTask.set(it.instanceId, prev ? { ...prev, deadlinePassed: prev.deadlinePassed || it.deadlinePassed } : it);
  }
  // 締切を過ぎてしまったものを先頭に、あとは締切が近い順
  const sorted = [...byTask.values()].sort(
    (a, b) => Number(b.deadlinePassed) - Number(a.deadlinePassed) || a.dueAt.getTime() - b.dueAt.getTime(),
  );
  const lines: string[] = [];
  if (outage) lines.push(`止まっていた時間: ${formatOutage(outage, now)}`);
  for (const it of sorted.slice(0, MAX_LINES)) {
    lines.push(
      it.deadlinePassed
        ? `・${it.title}(締切 ${fmt(it.dueAt, now)} を過ぎました。manaba で提出を確認してください)`
        : `・${it.title}(締切 ${fmt(it.dueAt, now)})`,
    );
  }
  if (sorted.length > MAX_LINES) lines.push(`ほか ${sorted.length - MAX_LINES} 件`);
  const passed = sorted.filter((it) => it.deadlinePassed).length;
  const title =
    passed > 0
      ? `【要確認】止まっている間に締切を過ぎた課題が ${passed} 件あります`
      : `アプリが止まっていたため、通知 ${sorted.length} 件が遅れました`;
  return { title, body: lines.join("\n"), url: "/today", tag: "missed-reminders" };
}
