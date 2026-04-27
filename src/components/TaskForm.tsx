"use client";

import { useEffect, useState, useTransition } from "react";

type Priority = "LOW" | "MID" | "HIGH";
type Channel = "PUSH" | "SLACK";
type ReminderPreset = "none" | "at" | "m15" | "h1" | "d1";

const priorityLabel: Record<Priority, string> = { HIGH: "高", MID: "中", LOW: "低" };

const presets: { key: ReminderPreset; label: string; offsetMin: number | null }[] = [
  { key: "none", label: "なし", offsetMin: null },
  { key: "at", label: "開始時", offsetMin: 0 },
  { key: "m15", label: "15分前", offsetMin: -15 },
  { key: "h1", label: "1時間前", offsetMin: -60 },
  { key: "d1", label: "1日前", offsetMin: -60 * 24 },
];

export function TaskForm({
  ymd,
  itemType,
  defaultTime,
  onCancel,
  onSaved,
}: {
  ymd: string;
  itemType: "TASK" | "EVENT";
  defaultTime?: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [time, setTime] = useState(defaultTime ?? (itemType === "EVENT" ? "09:00" : "20:00"));
  const [priority, setPriority] = useState<Priority>("MID");
  const [required, setRequired] = useState(true);
  const [preset, setPreset] = useState<ReminderPreset>(itemType === "EVENT" ? "m15" : "h1");
  const [channel, setChannel] = useState<Channel>("PUSH");
  const [checklist, setChecklist] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [conflicts, setConflicts] = useState<
    { id: number; title: string; dueAt: string; itemType: "TASK" | "EVENT" }[]
  >([]);

  // 時刻が変わるたびに ±30分の重複をチェック
  useEffect(() => {
    if (!time) return;
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      const dueAt = new Date(`${ymd}T${time}:00+09:00`);
      const from = new Date(dueAt.getTime() - 60 * 60_000).toISOString();
      const to = new Date(dueAt.getTime() + 60 * 60_000).toISOString();
      try {
        const res = await fetch(`/api/tasks?from=${from}&to=${to}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const { instances } = (await res.json()) as { instances: { id: number; title: string; dueAt: string; itemType: "TASK" | "EVENT" }[] };
        const overlaps = instances.filter((it) => {
          const t = new Date(it.dueAt).getTime();
          return Math.abs(t - dueAt.getTime()) <= 30 * 60_000;
        });
        setConflicts(overlaps);
      } catch {
        /* abort: ignore */
      }
    }, 350);
    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [ymd, time]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    const dueAt = `${ymd}T${time}:00+09:00`;
    const cleanChecklist = checklist
      .map((s, i) => ({ label: s.trim(), orderIdx: i }))
      .filter((c) => c.label.length > 0);
    const presetEntry = presets.find((p) => p.key === preset)!;
    const reminders =
      presetEntry.offsetMin === null
        ? []
        : [{ offsetMin: presetEntry.offsetMin, channel }];

    const payload = {
      title: title.trim(),
      notes: notes.trim() || undefined,
      dueAt,
      itemType,
      required: itemType === "TASK" ? required : true,
      priority: itemType === "TASK" ? priority : "MID",
      tagIds: [],
      checklist: cleanChecklist,
      reminders,
    };

    startTransition(async () => {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await onSaved();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ? JSON.stringify(body.error) : "保存に失敗しました");
      }
    });
  };

  const isTask = itemType === "TASK";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">タイトル</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={isTask ? "レポート提出 / 宿題..." : "部活 / ミーティング..."}
          className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">日付</label>
          <input
            type="date"
            value={ymd}
            disabled
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-300"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">時刻</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <p className="font-medium">⚠️ ±30分以内に {conflicts.length} 件の予定/タスクがあります</p>
          <ul className="mt-1 space-y-0.5 text-amber-100/80">
            {conflicts.slice(0, 4).map((c) => (
              <li key={c.id}>
                ・{new Date(c.dueAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}{" "}
                {c.itemType === "EVENT" ? "[予定]" : "[タスク]"} {c.title}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-amber-300/70">
            登録は可能です。優先度高い方が上に表示されます
          </p>
        </div>
      )}

      {isTask && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">種別</label>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 p-1">
              {[
                { k: true, l: "必須" },
                { k: false, l: "任意" },
              ].map((o) => (
                <button
                  type="button"
                  key={String(o.k)}
                  onClick={() => setRequired(o.k)}
                  className={`rounded-md py-1.5 text-xs ${
                    required === o.k
                      ? "bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">優先度</label>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 p-1">
              {(["LOW", "MID", "HIGH"] as Priority[]).map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`rounded-md py-1.5 text-xs ${
                    priority === p ? "bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-slate-100" : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {priorityLabel[p]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">通知</label>
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 p-1">
          {presets.map((p) => (
            <button
              type="button"
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`rounded-md px-2.5 py-1.5 text-xs ${
                preset === p.key ? "bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-slate-100" : "text-slate-600 dark:text-slate-400"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset !== "none" && (
          <div className="mt-2 flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 p-1">
            {(["PUSH", "SLACK"] as Channel[]).map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setChannel(c)}
                className={`flex-1 rounded-md py-1.5 text-xs ${
                  channel === c ? "bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-slate-100" : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {c === "PUSH" ? "アプリ通知" : "Slack"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">
          持ち物チェック (任意)
        </label>
        <ul className="space-y-1.5">
          {checklist.map((line, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                value={line}
                onChange={(e) => {
                  const next = [...checklist];
                  next[i] = e.target.value;
                  setChecklist(next);
                }}
                placeholder="教科書 / ノート PC / 関数電卓..."
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => setChecklist(checklist.filter((_, j) => j !== i))}
                className="rounded-md px-2 py-1 text-xs text-slate-500"
                aria-label="削除"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setChecklist([...checklist, ""])}
          className="mt-2 text-xs text-sky-400"
        >
          + 行を追加
        </button>
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">メモ (任意)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="詳細..."
          className="w-full resize-none rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-4 py-2 text-sm text-slate-700 dark:text-slate-300"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
        >
          {pending ? "保存中…" : isTask ? "タスクを追加" : "予定を追加"}
        </button>
      </div>
    </form>
  );
}
