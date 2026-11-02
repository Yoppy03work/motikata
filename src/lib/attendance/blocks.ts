/**
 * 同名授業の「連続コマブロック」ユーティリティ (純関数)
 *
 * ChibaTechPortal から clean copy (2026-11-02)。モチカタの ClassSchedule に合わせ
 * id:number / courseName に変更。
 *
 * WHY: CIT の授業は 2〜3 時限連続で開講され、時間割データは時限ごとに 1 行。
 * 出席登録は連続ブロックにつき 1 回でよいが、同じ日に同名授業が非連続で入る場合 (補講) は
 * 別ブロックで、そのブロック開始時に改めて出席登録が必要 (実運用仕様)。
 */

export interface ClassPeriodRow {
  id: number;
  courseName: string;
  period: number;
}

/**
 * 同じ日の時間割行から、指定行が属する「同名授業の連続コマブロック」の行IDを返す。
 * 指定行が rows に無い場合は安全側でその行のみ ([classScheduleId]) を返す。
 */
export function blockRowIds(rows: ClassPeriodRow[], classScheduleId: number): number[] {
  const target = rows.find((r) => r.id === classScheduleId);
  if (!target) return [classScheduleId];

  const sameName = rows
    .filter((r) => r.courseName === target.courseName)
    .sort((a, b) => a.period - b.period);

  const runs: ClassPeriodRow[][] = [];
  let run: ClassPeriodRow[] = [];
  for (const r of sameName) {
    if (run.length > 0) {
      const last = run[run.length - 1];
      if (r.period === last.period || r.period === last.period + 1) {
        run.push(r);
        continue;
      }
      runs.push(run);
      run = [r];
    } else {
      run = [r];
    }
  }
  if (run.length > 0) runs.push(run);

  const block = runs.find((rn) => rn.some((r) => r.id === classScheduleId));
  return block ? block.map((r) => r.id) : [classScheduleId];
}
