"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildRrule, parseRrule, rruleLabel } from "@/lib/rrule";

type Item = {
  id: number;
  title: string;
  notes: string | null;
  itemType: "TASK" | "EVENT";
  required: boolean;
  priority: "LOW" | "MID" | "HIGH";
  defaultDueOffsetMin: number;
  rrule: string | null;
};

type RecurrenceKind = "DAILY" | "WEEKLY" | "MONTHLY";

const DOW_JA = ["日", "月", "火", "水", "木", "金", "土"];

type Form = {
  title: string;
  notes: string;
  itemType: "TASK" | "EVENT";
  required: boolean;
  priority: "LOW" | "MID" | "HIGH";
  // 表示上は HH:MM、保存時は分換算で defaultDueOffsetMin に入る
  timeHm: string;
  // 繰り返し設定
  kind: RecurrenceKind;
  weeklyDays: number[]; // 0=日..6=土
  monthlyDay: number; // 1..31
};

const DEFAULT_FORM: Form = {
  title: "",
  notes: "",
  itemType: "TASK",
  required: true,
  priority: "MID",
  timeHm: "20:00",
  kind: "DAILY",
  weeklyDays: [1], // 月
  monthlyDay: 1,
};

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return 60 * 20;
  return h * 60 + m;
}

function minutesToHm(min: number): string {
  const m = ((min % (60 * 24)) + 60 * 24) % (60 * 24);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function rruleToForm(rrule: string | null, offsetMin: number): Partial<Form> {
  const rec = parseRrule(rrule);
  const timeHm = minutesToHm(offsetMin);
  if (!rec) return { kind: "DAILY", timeHm };
  if (rec.kind === "DAILY") return { kind: "DAILY", timeHm };
  if (rec.kind === "WEEKLY") return { kind: "WEEKLY", weeklyDays: rec.days, timeHm };
  if (rec.kind === "MONTHLY")
    return { kind: "MONTHLY", monthlyDay: rec.day, timeHm };
  return { kind: "DAILY", timeHm };
}

function formToRrule(f: Form): string {
  if (f.kind === "DAILY") return buildRrule({ kind: "DAILY" });
  if (f.kind === "WEEKLY")
    return buildRrule({ kind: "WEEKLY", days: f.weeklyDays });
  return buildRrule({ kind: "MONTHLY", day: f.monthlyDay });
}

export function TemplatesClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/templates");
      if (res.ok) {
        const body = await res.json();
        setItems(body.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startNew = () => {
    setForm(DEFAULT_FORM);
    setEditing("new");
    setError(null);
  };

  const startEdit = (it: Item) => {
    setForm({
      ...DEFAULT_FORM,
      title: it.title,
      notes: it.notes ?? "",
      itemType: it.itemType,
      required: it.required,
      priority: it.priority,
      ...rruleToForm(it.rrule, it.defaultDueOffsetMin),
    });
    setEditing(it);
    setError(null);
  };

  const save = async () => {
    if (!form.title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    if (form.kind === "WEEKLY" && form.weeklyDays.length === 0) {
      setError("曜日を1つ以上選んでください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const payload = {
        title: form.title.trim(),
        notes: form.notes.trim() || null,
        itemType: form.itemType,
        required: form.itemType === "TASK" ? form.required : true,
        priority: form.priority,
        defaultDueOffsetMin: hmToMinutes(form.timeHm),
        rrule: formToRrule(form),
      };
      const url =
        editing === "new" || editing === null
          ? "/api/templates"
          : `/api/templates/${editing.id}`;
      const method = editing === "new" || editing === null ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof body.error === "string"
            ? body.error
            : `保存失敗 (${res.status})`,
        );
        return;
      }
      setEditing(null);
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const remove = async (it: Item) => {
    if (!confirm(`「${it.title}」を削除します。よろしいですか?`)) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${it.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(`削除失敗 (${res.status})`);
        return;
      }
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const toggleDay = (d: number) => {
    setForm((f) => ({
      ...f,
      weeklyDays: f.weeklyDays.includes(d)
        ? f.weeklyDays.filter((x) => x !== d)
        : [...f.weeklyDays, d].sort(),
    }));
  };

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.title.localeCompare(b.title)),
    [items],
  );

  return (
    <div>
      {/* 一覧 */}
      {loading ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : sortedItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
          まだテンプレートが登録されていません
        </div>
      ) : (
        <ul className="space-y-2">
          {sortedItems.map((it) => (
            <li
              key={it.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {it.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {rruleLabel(it.rrule)} ·{" "}
                    {minutesToHm(it.defaultDueOffsetMin)} ·{" "}
                    {it.itemType === "EVENT"
                      ? "予定"
                      : it.required
                        ? "必須"
                        : "任意"}
                  </p>
                  {it.notes && (
                    <p className="mt-1 truncate text-[11px] text-slate-600 dark:text-slate-400">
                      {it.notes}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(it)}
                    disabled={pending}
                    className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-700 dark:text-slate-300 disabled:opacity-50"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(it)}
                    disabled={pending}
                    className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-xs text-rose-600 dark:text-rose-300 disabled:opacity-50"
                  >
                    削除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={startNew}
        disabled={pending}
        className="mt-4 w-full rounded-xl bg-sky-500 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        + 新規テンプレート
      </button>

      {/* 編集モーダル */}
      {editing !== null && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
        >
          <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-y-auto rounded-t-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl sm:rounded-2xl">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {editing === "new" ? "新規テンプレート" : "テンプレートを編集"}
              </h2>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                閉じる
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="block text-xs text-slate-600 dark:text-slate-400">
                  タイトル
                </span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                  disabled={pending}
                  placeholder="例: 朝のストレッチ / 週次レポート"
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 outline-none focus:ring-2 focus:ring-sky-500"
                />
              </label>

              <label className="block">
                <span className="block text-xs text-slate-600 dark:text-slate-400">
                  メモ (任意)
                </span>
                <textarea
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  disabled={pending}
                  rows={2}
                  className="mt-1 w-full resize-none rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 outline-none focus:ring-2 focus:ring-sky-500"
                />
              </label>

              {/* 種別 + 必須/任意 + 優先度 */}
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="block text-xs text-slate-600 dark:text-slate-400">
                    種別
                  </span>
                  <div className="mt-1 grid grid-cols-2 gap-1 rounded-md bg-slate-100 dark:bg-slate-900 p-1">
                    {(
                      [
                        { v: "TASK" as const, label: "タスク" },
                        { v: "EVENT" as const, label: "予定" },
                      ]
                    ).map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() =>
                          setForm((f) => ({ ...f, itemType: o.v }))
                        }
                        className={`rounded py-1 text-xs ${
                          form.itemType === o.v
                            ? "bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                            : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="block">
                  <span className="block text-xs text-slate-600 dark:text-slate-400">
                    時刻
                  </span>
                  <input
                    type="time"
                    value={form.timeHm}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, timeHm: e.target.value }))
                    }
                    disabled={pending}
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </label>
              </div>

              {form.itemType === "TASK" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-xs text-slate-600 dark:text-slate-400">
                      必須/任意
                    </span>
                    <div className="mt-1 grid grid-cols-2 gap-1 rounded-md bg-slate-100 dark:bg-slate-900 p-1">
                      {(
                        [
                          { v: true, label: "必須" },
                          { v: false, label: "任意" },
                        ]
                      ).map((o) => (
                        <button
                          key={String(o.v)}
                          type="button"
                          onClick={() =>
                            setForm((f) => ({ ...f, required: o.v }))
                          }
                          className={`rounded py-1 text-xs ${
                            form.required === o.v
                              ? "bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                              : "text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </label>
                  <label className="block">
                    <span className="block text-xs text-slate-600 dark:text-slate-400">
                      優先度
                    </span>
                    <div className="mt-1 grid grid-cols-3 gap-1 rounded-md bg-slate-100 dark:bg-slate-900 p-1">
                      {(["LOW", "MID", "HIGH"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, priority: p }))}
                          className={`rounded py-1 text-xs ${
                            form.priority === p
                              ? "bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                              : "text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          {p === "HIGH" ? "高" : p === "MID" ? "中" : "低"}
                        </button>
                      ))}
                    </div>
                  </label>
                </div>
              )}

              {/* 繰り返しパターン */}
              <div>
                <span className="block text-xs text-slate-600 dark:text-slate-400">
                  繰り返し
                </span>
                <div className="mt-1 grid grid-cols-3 gap-1 rounded-md bg-slate-100 dark:bg-slate-900 p-1">
                  {(
                    [
                      { v: "DAILY" as const, label: "毎日" },
                      { v: "WEEKLY" as const, label: "毎週" },
                      { v: "MONTHLY" as const, label: "毎月" },
                    ]
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, kind: o.v }))}
                      className={`rounded py-1 text-xs ${
                        form.kind === o.v
                          ? "bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                          : "text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {form.kind === "WEEKLY" && (
                <div>
                  <span className="block text-xs text-slate-600 dark:text-slate-400">
                    曜日 (複数選択可)
                  </span>
                  <div className="mt-1 grid grid-cols-7 gap-1 rounded-md bg-slate-100 dark:bg-slate-900 p-1">
                    {DOW_JA.map((label, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleDay(i)}
                        className={`rounded py-1 text-xs ${
                          form.weeklyDays.includes(i)
                            ? "bg-sky-500 text-white"
                            : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {form.kind === "MONTHLY" && (
                <label className="block">
                  <span className="block text-xs text-slate-600 dark:text-slate-400">
                    毎月の日付
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={form.monthlyDay}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        monthlyDay: Math.max(
                          1,
                          Math.min(31, Number(e.target.value) || 1),
                        ),
                      }))
                    }
                    disabled={pending}
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <span className="mt-1 block text-[11px] text-slate-500">
                    存在しない日(例: 31 で2月)はスキップされます
                  </span>
                </label>
              )}

              {error && <p className="text-xs text-rose-500">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={pending}
                  className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={pending}
                  className="flex-1 rounded-md bg-sky-500 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {pending ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
