"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TZ } from "@/lib/tz";
import type { TodayItem } from "./types";

const priorityLabel: Record<TodayItem["priority"], string> = {
  HIGH: "高",
  MID: "中",
  LOW: "低",
};

const priorityTone: Record<TodayItem["priority"], string> = {
  HIGH: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  MID: "border-slate-400 dark:border-slate-600 bg-slate-300/40 dark:bg-slate-700/40 text-slate-700 dark:text-slate-300",
  LOW: "border-slate-300 dark:border-slate-700 bg-slate-200/40 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400",
};

export function TodayItemCard({
  item,
  prepareMode = false,
}: {
  item: TodayItem;
  prepareMode?: boolean;
}) {
  const router = useRouter();
  const [checklist, setChecklist] = useState(item.checklist);
  const [done, setDone] = useState(item.status === "DONE");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const due = new Date(item.dueAt);
  const isEvent = item.itemType === "EVENT";

  const toggleCheck = (id: number) => {
    const target = checklist.find((c) => c.id === id);
    if (!target) return;
    const nextChecked = !target.checked;
    // Optimistic
    setChecklist((prev) => prev.map((c) => (c.id === id ? { ...c, checked: nextChecked } : c)));
    startTransition(async () => {
      const res = await fetch(`/api/checklist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: nextChecked }),
      });
      if (!res.ok) {
        // Revert
        setChecklist((prev) => prev.map((c) => (c.id === id ? { ...c, checked: !nextChecked } : c)));
        setError("更新に失敗しました");
      }
    });
  };

  const complete = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${item.id}/complete`, { method: "POST" });
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else {
        setError("完了処理に失敗しました");
      }
    });
  };

  const uncomplete = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${item.id}/uncomplete`, { method: "POST" });
      if (res.ok) {
        setDone(false);
        router.refresh();
      } else {
        setError("更新に失敗しました");
      }
    });
  };

  const snooze = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${item.id}/snooze`, { method: "POST" });
      if (res.ok) {
        // Soft signal: 1時間後に通知
        router.refresh();
      } else {
        setError("スヌーズに失敗しました");
      }
    });
  };

  return (
    <article
      className={`rounded-2xl border p-4 ${
        done
          ? "border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 opacity-60"
          : isEvent
            ? "border-sky-900/40 bg-slate-100 dark:bg-slate-900"
            : item.required
              ? "border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
              : "border-slate-200/60 dark:border-slate-800/60 bg-slate-100/70 dark:bg-slate-900/70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm text-slate-600 dark:text-slate-400">{formatInTimeZone(due, APP_TZ, "HH:mm")}</span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                isEvent
                  ? "bg-sky-500/15 text-sky-300"
                  : item.required
                    ? "bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                    : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
              }`}
            >
              {isEvent ? "予定" : item.required ? "必須" : "任意"}
            </span>
            {!isEvent && (
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${priorityTone[item.priority]}`}
              >
                {priorityLabel[item.priority]}
              </span>
            )}
            {item.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-md bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-700 dark:text-slate-300"
                style={t.color ? { color: t.color } : undefined}
              >
                {t.name}
              </span>
            ))}
          </div>
          <h3 className={`mt-1 truncate text-base font-semibold ${done ? "line-through" : ""}`}>
            {item.title}
          </h3>
          {item.subtitle && (
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-400">{item.subtitle}</p>
          )}
        </div>
      </div>

      {checklist.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {checklist.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-3 py-1.5 touch-manipulation">
                <input
                  type="checkbox"
                  checked={c.checked}
                  onChange={() => toggleCheck(c.id)}
                  disabled={pending && false /* don't block UX */}
                  className="h-5 w-5 rounded border-slate-400 dark:border-slate-600 bg-slate-200 dark:bg-slate-800 accent-sky-500"
                />
                <span className={`text-sm ${c.checked ? "text-slate-500 line-through" : ""}`}>
                  {c.label}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {!done && !prepareMode && !isEvent && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={complete}
            disabled={pending}
            className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
          >
            完了
          </button>
          <button
            onClick={snooze}
            disabled={pending}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50"
          >
            1時間後に
          </button>
        </div>
      )}

      {done && !prepareMode && (
        <div className="mt-3">
          <button
            onClick={uncomplete}
            disabled={pending}
            className="text-xs text-slate-600 dark:text-slate-400 underline-offset-2 hover:underline disabled:opacity-50"
          >
            完了を取り消す
          </button>
        </div>
      )}

      {prepareMode && checklist.length > 0 && (
        <p className="mt-2 text-[11px] text-violet-300/80">
          今夜のうちにカバンに入れておく持ち物
        </p>
      )}

      {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
    </article>
  );
}
