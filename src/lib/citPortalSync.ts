// CITポータル同期の共有実装。
// /api/cit-portal/sync(ユーザ手動)と /api/jobs/cit-portal-sync(cron)の両方から呼ぶ。
//
// 動作:
//   1. CitPortalCredential を読んでパスワード+TOTPシークレットを復号
//   2. fetchCitPortalTimetable で時間割を取得
//   3. ClassSchedule を全置換(履修登録変更があり得るので新しい結果で完全に置き換え)
//      - トランザクション内で deleteMany → createMany
//      - 関連する ClassTag, TaskTemplate(classScheduleId) は cascade で消える
//      - ChecklistTemplate(ownerType=CLASS, ownerId=...) は cascade されないので
//        個別に deleteMany する
//   4. lastSyncedAt / lastError を書き戻し
//
// 並行制御:
//   同期中に再度呼ばれた場合は同じ Promise を返す(in-process mutex)。
//   理由: 同じ TOTP コード (30秒窓)を連続送信すると Keycloak の replay 検出で
//   後続が「無効なワンタイムコード」になる。ボタン連打や cron×手動の同時実行を
//   この層で吸収する。

import { prisma } from "@/lib/db";
import {
  decryptCitPortalPassword,
  decryptCitPortalTotpSecret,
} from "@/lib/citPortalCrypto";
import {
  fetchCitPortalTimetable,
  CitPortalError,
  type CitPortalClass,
} from "@/lib/citPortalScrape";

export type CitPortalSyncResult =
  | {
      ok: true;
      fetched: number;
      replaced: number;
    }
  | {
      ok: false;
      error: string;
      stage: "no-credential" | "decrypt" | "scrape" | "db";
    };

// in-process でただ1つだけ走らせる
let inFlight: Promise<CitPortalSyncResult> | null = null;
// 直近の OTP 送信タイムスタンプ(ms)。同じ TOTP 30秒窓に再送するとKeycloakが
// replay 拒否するため、最低でも次の窓まで待つ。
let lastOtpAttemptMs = 0;

export function runCitPortalSync(): Promise<CitPortalSyncResult> {
  if (inFlight) {
    // 既に走っているなら結果を共有する(連打吸収)
    return inFlight;
  }
  inFlight = doRunCitPortalSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRunCitPortalSync(): Promise<CitPortalSyncResult> {
  const cred = await prisma.citPortalCredential.findFirst();
  if (!cred) {
    return {
      ok: false,
      error: "CITポータル認証情報が登録されていません",
      stage: "no-credential",
    };
  }

  let plainPassword: string;
  let plainTotpSecret: string;
  try {
    plainPassword = decryptCitPortalPassword(cred.passwordEnc);
    plainTotpSecret = decryptCitPortalTotpSecret(cred.totpSecretEnc);
  } catch {
    return {
      ok: false,
      error: "認証情報の復号に失敗(SESSION_SECRET を変更しましたか?)",
      stage: "decrypt",
    };
  }

  // 同じ TOTP 30秒窓で再試行すると Keycloak がリプレイ拒否するため、
  // 直前の試行から十分な秒数(35秒)経過するのを待つ。
  // 初回(lastOtpAttemptMs=0)は即時実行。
  if (lastOtpAttemptMs > 0) {
    const elapsed = Date.now() - lastOtpAttemptMs;
    const minIntervalMs = 35_000;
    if (elapsed < minIntervalMs) {
      const waitMs = minIntervalMs - elapsed;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  lastOtpAttemptMs = Date.now();

  let classes: CitPortalClass[];
  try {
    classes = await fetchCitPortalTimetable(
      cred.username,
      plainPassword,
      plainTotpSecret,
      cred.totpDeviceName,
    );
  } catch (e) {
    const msg =
      e instanceof CitPortalError
        ? `${e.stage}: ${e.message}`
        : e instanceof Error
          ? e.message
          : "unknown error";
    await prisma.citPortalCredential.update({
      where: { id: cred.id },
      data: { lastError: msg.slice(0, 500) },
    });
    return { ok: false, error: msg, stage: "scrape" };
  }

  // ClassSchedule を全置換。
  // 注意:
  //   - TaskTemplate.classScheduleId は onDelete: Cascade なので
  //     ClassSchedule 削除と同時に CLASS-kind TaskTemplate も消える
  //   - ChecklistTemplate(ownerType=CLASS, ownerId=...)は緩い参照なので
  //     先に手動 deleteMany する
  let replaced = 0;
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.classSchedule.findMany({ select: { id: true } });
      const existingIds = existing.map((r) => r.id);
      if (existingIds.length > 0) {
        await tx.checklistTemplate.deleteMany({
          where: { ownerType: "CLASS", ownerId: { in: existingIds } },
        });
        await tx.classSchedule.deleteMany({
          where: { id: { in: existingIds } },
        });
      }
      if (classes.length > 0) {
        await tx.classSchedule.createMany({
          data: classes.map((c) => ({
            dayOfWeek: c.dayOfWeek,
            period: c.period,
            endPeriod: c.endPeriod,
            startTime: c.startTime,
            endTime: c.endTime,
            courseName: c.courseName,
            classroom: c.classroom,
            teacher: c.teacher,
            // 学期境界(前期/後期)を保存。/classes 画面で学期フィルタが効くため必須。
            effectiveFrom: c.effectiveFrom,
            effectiveTo: c.effectiveTo,
          })),
        });
      }
      replaced = classes.length;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "db error";
    await prisma.citPortalCredential.update({
      where: { id: cred.id },
      data: { lastError: msg.slice(0, 500) },
    });
    return { ok: false, error: msg, stage: "db" };
  }

  await prisma.citPortalCredential.update({
    where: { id: cred.id },
    data: { lastSyncedAt: new Date(), lastError: null },
  });

  return {
    ok: true,
    fetched: classes.length,
    replaced,
  };
}
