/**
 * 出席オーケストレーション層 (DB 副作用あり)。
 *
 * ChibaTechPortal の attendance-job / submit API 相当を単一ユーザー + node-cron 向けに移植。
 * 純粋ロジック (guards / room-normalize / blocks / time) はここから呼ぶ。
 *
 * モード別の役割 (CTP と同じ):
 *   - manual : ローカル DB に記録するだけ (外部送信なし)。自分で QR を取った後の記録用。
 *   - confirm: モチカタが出席システムに実送信する (QR スキャンで roomId を得る)。
 *   - auto   : scheduler(tick) が送信。フェーズ A では dark (env 未設定で送信しない)。
 *
 * SECURITY: creds / QR / 出席システム HTML をログ・監査 reason に出さない。
 */
import { prisma } from "@/lib/db";
import { decryptCitPortalPassword } from "@/lib/citPortalCrypto";
import { AttendanceHttpAdapter, type AttendanceResult } from "./http";
import { getJstParts, hhmmToMinutes } from "./time";
import {
  evaluateConfirmSubmitGuard,
  type ConfirmSubmitGuardResult,
} from "./confirm-guard";
import {
  evaluateAttendanceAutoGuardPreNetwork,
  evaluateAttendanceAutoGuard,
} from "./auto-guard";
import { blockRowIds } from "./blocks";
import {
  ATTENDANCE_SETTING_KEY,
  normalizeAttendanceSettings,
  type AttendanceMode,
} from "./settings";
import { isAutoExecutionEnabled, isAutoDryRun } from "./rollout";

type ClassRow = {
  id: number;
  dayOfWeek: number;
  period: number;
  endPeriod: number;
  startTime: string;
  endTime: string;
  courseName: string;
  classroom: string | null;
};

const CLASS_SELECT = {
  id: true,
  dayOfWeek: true,
  period: true,
  endPeriod: true,
  startTime: true,
  endTime: true,
  courseName: true,
  classroom: true,
} as const;

/** CIT 認証情報 (ポータルと同じ学籍番号+パスワード) を読み出して復号する。失敗時 null。 */
export async function loadCitCredentials(): Promise<{
  username: string;
  password: string;
} | null> {
  const row = await prisma.citPortalCredential.findFirst({
    orderBy: { id: "desc" },
    select: { username: true, passwordEnc: true },
  });
  if (!row) return null;
  try {
    return { username: row.username, password: decryptCitPortalPassword(row.passwordEnc) };
  } catch {
    return null; // 鍵不一致など
  }
}

export async function hasCitCredentials(): Promise<boolean> {
  const row = await prisma.citPortalCredential.findFirst({ select: { id: true } });
  return row !== null;
}

/** 出席モード (Setting key="attendance")。未設定/壊れた値は confirm。 */
export async function getAttendanceMode(): Promise<AttendanceMode> {
  const row = await prisma.setting.findUnique({ where: { key: ATTENDANCE_SETTING_KEY } });
  return normalizeAttendanceSettings(row?.value).mode;
}

export async function setAttendanceMode(mode: AttendanceMode): Promise<void> {
  await prisma.setting.upsert({
    where: { key: ATTENDANCE_SETTING_KEY },
    create: { key: ATTENDANCE_SETTING_KEY, value: { mode } },
    update: { value: { mode } },
  });
}

/** 今日(JST) に有効な ClassSchedule 行 (曜日一致 + 有効期間内) を period 昇順で返す。 */
export async function getTodayClasses(now: Date): Promise<ClassRow[]> {
  const jst = getJstParts(now);
  return prisma.classSchedule.findMany({
    where: {
      dayOfWeek: jst.dayOfWeek,
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
      ],
    },
    orderBy: { period: "asc" },
    select: CLASS_SELECT,
  });
}

/** append-only 監査ログを 1 行足す。失敗しても本処理は止めない。 */
async function writeAudit(data: {
  classScheduleId?: number | null;
  classDate?: string | null;
  method?: string | null;
  phase: "pre_attempt" | "post_attempt" | "skipped" | "blocked";
  outcome?: "success" | "failed" | null;
  reason?: string | null;
  jobId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.attendanceAuditLog.create({
      data: {
        classScheduleId: data.classScheduleId ?? null,
        classDate: data.classDate ?? null,
        method: data.method ?? null,
        phase: data.phase,
        outcome: data.outcome ?? null,
        reason: data.reason ?? null,
        jobId: data.jobId ?? null,
        metadata: (data.metadata ?? undefined) as never,
      },
    });
  } catch {
    // 監査ログの失敗で出席処理を壊さない
  }
}

/**
 * 同じブロック (連続コマ同名授業) のいずれかで、今日すでに成功登録済みか。
 * method は confirm / auto / manual いずれも「出席済み」とみなす (CTP のブロック単位重複)。
 */
async function blockAlreadySubmitted(
  blockIds: number[],
  classDateYmd: string,
): Promise<boolean> {
  const hit = await prisma.attendanceLog.findFirst({
    where: {
      classScheduleId: { in: blockIds },
      classDate: classDateYmd,
      status: { in: ["success", "manual"] },
    },
    select: { id: true },
  });
  return hit !== null;
}

export type SubmitResult =
  | { ok: true; message: string; alreadyDone?: boolean }
  | { ok: false; reason: string; message: string };

/**
 * confirm: QR スキャンで得た roomId を使って出席システムに実送信する。
 * guard → claim(pending) → adapter.attend → log(success/failed) + audit。
 */
export async function submitConfirm(
  input: { classScheduleId: number; classDateYmd: string; roomId: string },
  now: Date = new Date(),
): Promise<SubmitResult> {
  const cls = await prisma.classSchedule.findUnique({
    where: { id: input.classScheduleId },
    select: CLASS_SELECT,
  });
  if (!cls) {
    return { ok: false, reason: "class_not_found", message: "授業が見つかりません" };
  }

  const today = await getTodayClasses(now);
  const blockIds = blockRowIds(
    today.map((c) => ({ id: c.id, courseName: c.courseName, period: c.period })),
    cls.id,
  );

  if (await blockAlreadySubmitted(blockIds, input.classDateYmd)) {
    return { ok: true, alreadyDone: true, message: "このコマは出席済みです" };
  }

  const startMinutes = hhmmToMinutes(cls.startTime);
  const creds = await loadCitCredentials();

  // 教室が未入力のときは room 一致チェックを緩める (単一ユーザーが物理的に QR をスキャン
  // しているため)。教室が入力済みなら厳密に突合して誤教室スキャンを弾く。
  const classroomForGuard = cls.classroom?.trim() ? cls.classroom : input.roomId;

  const guard: ConfirmSubmitGuardResult = evaluateConfirmSubmitGuard({
    jobRoomId: input.roomId,
    jobClassDateYmd: input.classDateYmd,
    classroom: classroomForGuard,
    classDayOfWeek: cls.dayOfWeek,
    classStartMinutes: startMinutes ?? -1000, // null は必ずウィンドウ外
    alreadySubmittedConfirm: false, // ブロック重複は上で判定済み
    hasCitCreds: creds !== null,
    now,
  });
  if (!guard.allowed) {
    await writeAudit({
      classScheduleId: cls.id,
      classDate: input.classDateYmd,
      method: "confirm",
      phase: "blocked",
      reason: guard.reason,
    });
    return { ok: false, reason: guard.reason, message: guardMessage(guard.reason) };
  }

  // claim: pending 行を unique 制約で確保 (二重送信防止)。
  try {
    await prisma.attendanceLog.create({
      data: {
        classScheduleId: cls.id,
        classDate: input.classDateYmd,
        method: "confirm",
        status: "pending",
      },
    });
  } catch {
    // P2002 (既に confirm 行がある) = 送信中 or 済み。安全側で停止。
    return { ok: false, reason: "in_progress", message: "送信処理中です" };
  }

  await writeAudit({
    classScheduleId: cls.id,
    classDate: input.classDateYmd,
    method: "confirm",
    phase: "pre_attempt",
  });

  const adapter = new AttendanceHttpAdapter();
  const result: AttendanceResult = await adapter.attend(
    creds!.username,
    creds!.password,
    input.roomId,
  );

  await prisma.attendanceLog.update({
    where: {
      classScheduleId_classDate_method: {
        classScheduleId: cls.id,
        classDate: input.classDateYmd,
        method: "confirm",
      },
    },
    data: {
      status: result.success ? "success" : "failed",
      errorDetail: result.success ? null : result.outcome,
    },
  });
  await writeAudit({
    classScheduleId: cls.id,
    classDate: input.classDateYmd,
    method: "confirm",
    phase: "post_attempt",
    outcome: result.success ? "success" : "failed",
    reason: result.success ? null : result.outcome,
  });

  if (result.success) {
    return { ok: true, message: result.message };
  }
  return { ok: false, reason: result.outcome, message: result.message };
}

/** manual: ローカル DB に「出席済み」を記録するだけ (外部送信なし)。 */
export async function recordManual(
  input: { classScheduleId: number; classDateYmd: string },
): Promise<SubmitResult> {
  const cls = await prisma.classSchedule.findUnique({
    where: { id: input.classScheduleId },
    select: { id: true },
  });
  if (!cls) {
    return { ok: false, reason: "class_not_found", message: "授業が見つかりません" };
  }
  await prisma.attendanceLog.upsert({
    where: {
      classScheduleId_classDate_method: {
        classScheduleId: input.classScheduleId,
        classDate: input.classDateYmd,
        method: "manual",
      },
    },
    create: {
      classScheduleId: input.classScheduleId,
      classDate: input.classDateYmd,
      method: "manual",
      status: "manual",
    },
    update: { status: "manual", attemptedAt: new Date() },
  });
  return { ok: true, message: "出席済みにしました (ローカル記録)" };
}

function guardMessage(reason: string): string {
  switch (reason) {
    case "room_mismatch":
      return "QR の教室が授業の教室と一致しません";
    case "outside_time_window":
      return "出席できる時間帯ではありません (開始5分前前後)";
    case "already_submitted":
      return "このコマは出席済みです";
    case "credentials_not_registered":
      return "CIT 認証情報が未登録です (設定から登録してください)";
    case "class_date_mismatch":
      return "対象の日付が今日ではありません";
    default:
      return "出席を登録できませんでした";
  }
}

/**
 * auto ティック (node-cron から毎分呼ばれる job が実行)。
 * フェーズ A では isAutoExecutionEnabled()=false のため pre-network で skipped に倒れ、
 * 監査ログに残すだけで一切送信しない (dark)。フェーズ B の env 解禁で実送信が生きる。
 */
export async function runAutoTick(now: Date = new Date()): Promise<{
  examined: number;
  attempted: number;
  skipped: number;
}> {
  const mode = await getAttendanceMode();
  const autoEnabled = isAutoExecutionEnabled();
  const today = await getTodayClasses(now);
  const jst = getJstParts(now);

  let examined = 0;
  let attempted = 0;
  let skipped = 0;

  for (const cls of today) {
    const startMinutes = hhmmToMinutes(cls.startTime);
    if (startMinutes === null) continue;
    // ウィンドウ近傍のコマだけ見る (監査ノイズを抑える)
    if (Math.abs(jst.minutesOfDay - (startMinutes - 5)) > 3) continue;
    examined++;

    const classDateYmd = jst.ymd;
    const session = await prisma.attendanceQrSession.findFirst({
      where: { classScheduleId: cls.id, classDate: classDateYmd, expiresAt: { gt: now } },
      select: { roomId: true },
    });
    const blockIds = blockRowIds(
      today.map((c) => ({ id: c.id, courseName: c.courseName, period: c.period })),
      cls.id,
    );
    const already = await blockAlreadySubmitted(blockIds, classDateYmd);

    const pre = evaluateAttendanceAutoGuardPreNetwork({
      autoExecutionEnabled: autoEnabled,
      method: "auto",
      storedMode: mode,
      classroom: cls.classroom,
      jobRoomId: session?.roomId ?? "",
      classDayOfWeek: cls.dayOfWeek,
      classStartMinutes: startMinutes,
      now,
      alreadySubmitted: already,
      qrSessionValid: session !== null,
    });

    if (!pre.allowed) {
      skipped++;
      await writeAudit({
        classScheduleId: cls.id,
        classDate: classDateYmd,
        method: "auto",
        phase: "skipped",
        reason: pre.reason,
        jobId: `auto-${cls.id}-${classDateYmd}`,
      });
      continue;
    }

    // ここから先は auto 解禁 (フェーズ B) でのみ到達する。
    const creds = await loadCitCredentials();
    if (!creds) {
      skipped++;
      await writeAudit({
        classScheduleId: cls.id,
        classDate: classDateYmd,
        method: "auto",
        phase: "skipped",
        reason: "credentials_not_registered",
        jobId: `auto-${cls.id}-${classDateYmd}`,
      });
      continue;
    }

    const adapter = new AttendanceHttpAdapter();
    const reachable = await adapter.healthCheck();
    const full = evaluateAttendanceAutoGuard({
      autoExecutionEnabled: autoEnabled,
      method: "auto",
      storedMode: mode,
      classroom: cls.classroom,
      jobRoomId: session!.roomId,
      classDayOfWeek: cls.dayOfWeek,
      classStartMinutes: startMinutes,
      now,
      alreadySubmitted: already,
      qrSessionValid: true,
      campusReachable: reachable,
    });
    if (!full.allowed) {
      skipped++;
      await writeAudit({
        classScheduleId: cls.id,
        classDate: classDateYmd,
        method: "auto",
        phase: "skipped",
        reason: full.reason,
        jobId: `auto-${cls.id}-${classDateYmd}`,
      });
      continue;
    }

    // dry-run: guard は通すが実送信しない
    if (isAutoDryRun()) {
      attempted++;
      await writeAudit({
        classScheduleId: cls.id,
        classDate: classDateYmd,
        method: "auto",
        phase: "post_attempt",
        outcome: "success",
        reason: "dry-run (no external send)",
        jobId: `auto-${cls.id}-${classDateYmd}`,
      });
      continue;
    }

    // 実送信 (claim → attend → log)
    try {
      await prisma.attendanceLog.create({
        data: {
          classScheduleId: cls.id,
          classDate: classDateYmd,
          method: "auto",
          status: "pending",
        },
      });
    } catch {
      skipped++;
      continue;
    }
    await writeAudit({
      classScheduleId: cls.id,
      classDate: classDateYmd,
      method: "auto",
      phase: "pre_attempt",
      jobId: `auto-${cls.id}-${classDateYmd}`,
    });
    const result = await adapter.attend(creds.username, creds.password, session!.roomId);
    attempted++;
    await prisma.attendanceLog.update({
      where: {
        classScheduleId_classDate_method: {
          classScheduleId: cls.id,
          classDate: classDateYmd,
          method: "auto",
        },
      },
      data: {
        status: result.success ? "success" : "failed",
        errorDetail: result.success ? null : result.outcome,
      },
    });
    await writeAudit({
      classScheduleId: cls.id,
      classDate: classDateYmd,
      method: "auto",
      phase: "post_attempt",
      outcome: result.success ? "success" : "failed",
      reason: result.success ? null : result.outcome,
      jobId: `auto-${cls.id}-${classDateYmd}`,
    });
  }

  return { examined, attempted, skipped };
}
