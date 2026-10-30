// manaba の課題の種類(レポート / アンケート / 小テスト 等)のラベル。
// TaskInstance.academicKind が null なら何も出さない。
export function AcademicKindBadge({ kind }: { kind?: string | null }) {
  if (!kind) return null;
  return (
    <span className="shrink-0 rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
      {kind}
    </span>
  );
}
