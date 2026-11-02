// 出席ガード用の JST 時刻ユーティリティ。
//
// WHY: 千葉工大の授業時刻は JST 固定。コンテナ TZ (UTC デプロイ等) に依存しないよう、
// date-fns-tz の formatInTimeZone で「Asia/Tokyo の壁掛け時計」を文字列経由で取り出す。
// today ページ (src/app/(app)/today/page.tsx) と同じ方針 — toZonedTime().getHours() は
// ランタイム TZ 依存になるので使わない。

import { formatInTimeZone } from "date-fns-tz";
import { APP_TZ } from "@/lib/tz";

export interface JstParts {
  /** YYYY-MM-DD (JST カレンダー日) */
  ymd: string;
  /** 0=日 .. 6=土 */
  dayOfWeek: number;
  hour: number;
  minute: number;
  /** その日の 0:00 からの経過分 (hour*60+minute) */
  minutesOfDay: number;
}

/** Date を JST の 年月日/曜日/時分 に分解する。コンテナ TZ 非依存。 */
export function getJstParts(date: Date): JstParts {
  const ymd = formatInTimeZone(date, APP_TZ, "yyyy-MM-dd");
  // ISO day: 1=月 .. 7=日。% 7 で 日=0 .. 土=6 に揃える。
  const isoDay = Number(formatInTimeZone(date, APP_TZ, "i"));
  const dayOfWeek = isoDay % 7;
  const hour = Number(formatInTimeZone(date, APP_TZ, "HH"));
  const minute = Number(formatInTimeZone(date, APP_TZ, "mm"));
  return { ymd, dayOfWeek, hour, minute, minutesOfDay: hour * 60 + minute };
}

/** Date を JST のカレンダー日 YYYY-MM-DD に整形する。 */
export function formatJstYmd(date: Date): string {
  return formatInTimeZone(date, APP_TZ, "yyyy-MM-dd");
}

/**
 * "HH:mm" を 0:00 からの経過分に変換する。不正形式は null。
 * WHY: ClassSchedule.startTime は "HH:mm" 文字列で保存されている。授業開始時刻の
 * 真実源はこの値なので、時限→時刻の定数表は持たず startTime を直接使う。
 */
export function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** 授業開始の何分前を出席ターゲットにするか (CTP と同じ 5 分前)。 */
export const ATTENDANCE_LEAD_MINUTES = 5;
/** 出席ウィンドウの許容幅 (開始 5 分前 ±2 分)。 */
export const ATTENDANCE_WINDOW_TOLERANCE_MINUTES = 2;

/**
 * 現在時刻が「当該曜日の授業開始 5 分前 ±2 分」ウィンドウ内かを判定する。
 * startTimeMinutes は ClassSchedule.startTime("HH:mm") を hhmmToMinutes した値。
 */
export function isInAttendanceWindow(
  now: Date,
  dayOfWeek: number,
  startTimeMinutes: number,
): boolean {
  const jst = getJstParts(now);
  if (jst.dayOfWeek !== dayOfWeek) return false;
  const target = startTimeMinutes - ATTENDANCE_LEAD_MINUTES;
  return Math.abs(jst.minutesOfDay - target) <= ATTENDANCE_WINDOW_TOLERANCE_MINUTES;
}

/** confirm (人が手でタップ) 用の緩いウィンドウ。開始 N 分前 〜 開始 M 分後。 */
export const CONFIRM_WINDOW_BEFORE_MINUTES = 10;
export const CONFIRM_WINDOW_AFTER_MINUTES = 60;

/**
 * confirm 出席の許容ウィンドウ内か。
 * WHY: auto (scheduler が正確に発火) と違い confirm は人が開いてタップするので、
 * ±2 分では実質間に合わない。開始 10 分前〜60 分後まで許す。実際に出席できるかの
 * 最終判定は出席システム自身 (「出席できる授業はありません」) が backstop になる。
 */
export function isInConfirmWindow(
  now: Date,
  dayOfWeek: number,
  startTimeMinutes: number,
): boolean {
  const jst = getJstParts(now);
  if (jst.dayOfWeek !== dayOfWeek) return false;
  return (
    jst.minutesOfDay >= startTimeMinutes - CONFIRM_WINDOW_BEFORE_MINUTES &&
    jst.minutesOfDay <= startTimeMinutes + CONFIRM_WINDOW_AFTER_MINUTES
  );
}
