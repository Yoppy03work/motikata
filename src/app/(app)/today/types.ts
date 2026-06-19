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
  tags: { id: number; name: string; color?: string | null }[];
  checklist: { id: number; label: string; checked: boolean }[];
};
