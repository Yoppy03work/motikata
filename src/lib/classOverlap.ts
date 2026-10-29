import type { Prisma } from "@/generated/prisma/client";

/**
 * 時間割の重複チェック用の where 条件。
 * 同じ曜日で時限が交差し、かつ有効期間(effectiveFrom〜effectiveTo)も重なる行を探す。
 * 期間が null の側は「無期限」として扱う(手動入力の全年度授業など)。
 *
 * 以前は期間を見ていなかったので、前期の授業がある枠に後期の授業を
 * 追加しようとすると「重なっています」で弾かれていた。
 */
export function classOverlapWhere(args: {
  dayOfWeek: number;
  period: number;
  endPeriod: number;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  excludeId?: number;
}): Prisma.ClassScheduleWhereInput {
  const { dayOfWeek, period, endPeriod, effectiveFrom, effectiveTo, excludeId } =
    args;
  return {
    ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
    dayOfWeek,
    // 区間重なり判定: A.period <= B.endPeriod && A.endPeriod >= B.period
    period: { lte: endPeriod },
    endPeriod: { gte: period },
    AND: [
      effectiveFrom
        ? { OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] }
        : {},
      effectiveTo
        ? { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: effectiveTo } }] }
        : {},
    ],
  };
}
