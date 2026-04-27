"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale/ja";
import Link from "next/link";
import { TaskForm } from "./TaskForm";

type Instance = {
  id: number;
  title: string;
  notes: string | null;
  dueAt: string;
  itemType: "TASK" | "EVENT";
  required: boolean;
  priority: "LOW" | "MID" | "HIGH";
  status: "OPEN" | "DONE" | "SKIPPED";
  source: string;
  checklist: { id: number; label: string; checkedAt: string | null; orderIdx: number }[];
  tags: { tag: { id: number; name: string; color: string | null } }[];
};

export function DayDetailSheet({
  open,
  onClose,
  ymd,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  ymd: string;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "add-event" | "add-task">("list");

  const load = useCallback(async () => {
    if (!ymd) return;
    setLoading(true);
    const from = `${ymd}T00:00:00+09:00`;
    const to = `${ymd}T23:59:59+09:00`;
    const q = new URLSearchParams({ from, to });
    const res = await fetch(`/api/tasks?${q}`);
    if (res.ok) {
      const { instances } = await res.json();
      setItems(instances);
    }
    setLoading(false);
  }, [ymd]);

  useEffect(() => {
    if (!open) return;
    setMode("list");
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  // ymd は JST 文脈の "YYYY-MM-DD"。クライアント側の format で日付がずれないよう
  // ローカル深夜の同 y/m/d を作る(format はその y/m/d をそのまま吐く)
  const [yy, mm, dd] = ymd.split("-").map(Number);
  const dateObj = new Date(yy, mm - 1, dd);
  const title = format(dateObj, "M月d日 (EEE)", { locale: ja });

  const events = items
    .filter((i) => i.itemType === "EVENT")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const required = items
    .filter((i) => i.itemType === "TASK" && i.required)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const optional = items
    .filter((i) => i.itemType === "TASK" && !i.required)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Link
            href={`/today?date=${ymd}`}
            className="text-xs text-sky-400 hover:underline"
            onClick={onClose}
          >
            この日を開く →
          </Link>
        </div>

        {mode === "list" && (
          <>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <p className="py-6 text-center text-sm text-slate-500">読み込み中…</p>
              ) : items.length === 0 ? (
                <p className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 p-4 text-sm text-slate-600 dark:text-slate-400">
                  この日はまだ何もありません
                </p>
              ) : (
                <div className="space-y-4">
                  {events.length > 0 && <Group label="📅 予定" items={events} />}
                  {required.length > 0 && <Group label="✅ 必須タスク" items={required} />}
                  {optional.length > 0 && <Group label="◎ 任意タスク" items={optional} muted />}
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode("add-event")}
                className="rounded-lg border border-sky-500/30 bg-sky-500/10 py-2.5 text-sm font-medium text-sky-300"
              >
                + 予定を追加
              </button>
              <button
                onClick={() => setMode("add-task")}
                className="rounded-lg bg-sky-500 py-2.5 text-sm font-medium text-slate-950"
              >
                + タスクを追加
              </button>
            </div>
          </>
        )}

        {(mode === "add-event" || mode === "add-task") && (
          <div className="flex-1 overflow-y-auto">
            <TaskForm
              ymd={ymd}
              itemType={mode === "add-event" ? "EVENT" : "TASK"}
              onCancel={() => setMode("list")}
              onSaved={async () => {
                setMode("list");
                await load();
                onChanged?.();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Group({
  label,
  items,
  muted = false,
}: {
  label: string;
  items: Instance[];
  muted?: boolean;
}) {
  return (
    <div className={muted ? "opacity-80" : ""}>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</h3>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li
            key={it.id}
            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {format(new Date(it.dueAt), "HH:mm")}
              </span>
              <span className="truncate text-sm">{it.title}</span>
              {it.itemType === "TASK" && !it.required && (
                <span className="ml-auto rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-400">
                  任意
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
