export type TodayItem = {
  id: number;
  itemType: "TASK" | "EVENT";
  required: boolean;
  source: "MANUAL" | "RECURRING" | "CLASS" | "ACADEMIC" | "GOOGLE";
  title: string;
  subtitle?: string;
  dueAt: string;
  priority: "LOW" | "MID" | "HIGH";
  status: "OPEN" | "DONE" | "SKIPPED";
  // Phase 14a: 終日イベント判定。true なら "HH:mm" 表示を省いて「終日」扱い。
  // Phase 13 で TaskInstance.isAllDay 列が入り、Google all-day event 由来で
  // true がセットされる。手入力タスクは false (current UI に toggle 未実装)。
  isAllDay?: boolean;
  // Phase 14a: 終了時刻 (ISO string)。multi-day event だと dueAt と異なる。
  // Google all-day では exclusive 翌日。null なら単点 event (Phase 13 以前と同様)。
  endAt?: string | null;
  tags: { id: number; name: string; color?: string | null }[];
  checklist: { id: number; label: string; checked: boolean }[];
};
