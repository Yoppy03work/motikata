"use client";

// 時間割マスター(ClassSchedule)の編集 UI。
// 曜日 × 時限のグリッドで、各セルに授業を1つ登録する。
// セルをタップ → 編集 / 追加モーダル。

import { useCallback, useEffect, useMemo, useState } from "react";

type Item = {
  id: number;
  dayOfWeek: number;
  period: number;
  startTime: string;
  endTime: string;
  courseName: string;
  classroom: string | null;
  teacher: string | null;
};

const DAYS = [
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" },
];

// CIT 学部の標準時間割(90分授業)。手動編集可能。
const PERIODS: { value: number; start: string; end: string }[] = [
  { value: 1, start: "09:00", end: "10:30" },
  { value: 2, start: "10:40", end: "12:10" },
  { value: 3, start: "13:00", end: "14:30" },
  { value: 4, start: "14:40", end: "16:10" },
  { value: 5, start: "16:20", end: "17:50" },
];

type EditTarget = {
  dayOfWeek: number;
  period: number;
  existing: Item | null;
};

type FormState = {
  courseName: string;
  classroom: string;
  teacher: string;
  startTime: string;
  endTime: string;
};

export function TimetableClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/classes");
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

  // 検索を高速化するため (dayOfWeek, period) のキーで Map 化
  const grid = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of items) {
      m.set(`${it.dayOfWeek}/${it.period}`, it);
    }
    return m;
  }, [items]);

  return (
    <div>
      {error && <p className="mb-2 text-xs text-rose-500">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="w-10 border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 p-1 text-slate-600 dark:text-slate-400">
                /
              </th>
              {DAYS.map((d) => (
                <th
                  key={d.value}
                  className="border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 p-1 text-slate-700 dark:text-slate-300"
                >
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map((p) => (
              <tr key={p.value}>
                <th className="border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 p-1 text-center align-top text-slate-600 dark:text-slate-400">
                  <div className="font-semibold">{p.value}</div>
                  <div className="mt-0.5 text-[9px] text-slate-500 tabular-nums">
                    {p.start}
                  </div>
                  <div className="text-[9px] text-slate-500 tabular-nums">
                    {p.end}
                  </div>
                </th>
                {DAYS.map((d) => {
                  const it = grid.get(`${d.value}/${p.value}`);
                  return (
                    <td
                      key={d.value}
                      className="border border-slate-200 dark:border-slate-700 align-top p-0"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({
                            dayOfWeek: d.value,
                            period: p.value,
                            existing: it ?? null,
                          })
                        }
                        className={`block w-full min-h-[3.75rem] p-1.5 text-left transition ${
                          it
                            ? "bg-sky-100 dark:bg-sky-500/10 hover:bg-sky-200 dark:hover:bg-sky-500/20"
                            : "hover:bg-slate-100 dark:hover:bg-slate-900"
                        }`}
                      >
                        {it ? (
                          <>
                            <div className="truncate text-[11px] font-medium text-slate-900 dark:text-slate-100">
                              {it.courseName}
                            </div>
                            {it.classroom && (
                              <div className="mt-0.5 truncate text-[10px] text-slate-600 dark:text-slate-400">
                                📍 {it.classroom}
                              </div>
                            )}
                            {it.teacher && (
                              <div className="truncate text-[10px] text-slate-500">
                                {it.teacher}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-[10px] text-slate-400 dark:text-slate-600">
                            +
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && <p className="mt-2 text-xs text-slate-500">読み込み中...</p>}

      {editing && (
        <EditModal
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
          pending={pending}
          setPending={setPending}
          setError={setError}
        />
      )}
    </div>
  );
}

function EditModal({
  target,
  onClose,
  onSaved,
  pending,
  setPending,
  setError,
}: {
  target: EditTarget;
  onClose: () => void;
  onSaved: () => Promise<void>;
  pending: boolean;
  setPending: (v: boolean) => void;
  setError: (v: string | null) => void;
}) {
  const period = PERIODS.find((p) => p.value === target.period);
  const day = DAYS.find((d) => d.value === target.dayOfWeek);
  const initial: FormState = useMemo(
    () => ({
      courseName: target.existing?.courseName ?? "",
      classroom: target.existing?.classroom ?? "",
      teacher: target.existing?.teacher ?? "",
      startTime: target.existing?.startTime ?? period?.start ?? "09:00",
      endTime: target.existing?.endTime ?? period?.end ?? "10:30",
    }),
    [target, period],
  );
  const [form, setForm] = useState<FormState>(initial);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.courseName.trim()) {
      setError("授業名を入力してください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body = {
        dayOfWeek: target.dayOfWeek,
        period: target.period,
        startTime: form.startTime,
        endTime: form.endTime,
        courseName: form.courseName.trim(),
        classroom: form.classroom.trim() || null,
        teacher: form.teacher.trim() || null,
      };
      const url = target.existing
        ? `/api/classes/${target.existing.id}`
        : "/api/classes";
      const method = target.existing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(typeof err.error === "string" ? err.error : `保存失敗 (${res.status})`);
        return;
      }
      await onSaved();
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!target.existing) return;
    if (!confirm("この授業を削除しますか?")) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/classes/${target.existing.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(`削除失敗 (${res.status})`);
        return;
      }
      await onSaved();
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">
            {day?.label}曜 {target.period}限
            {target.existing ? " 編集" : " 追加"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            閉じる
          </button>
        </div>
        <div className="space-y-2">
          <Field label="授業名" required>
            <input
              type="text"
              value={form.courseName}
              onChange={(e) => update({ courseName: e.target.value })}
              disabled={pending}
              autoFocus
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
            />
          </Field>
          <Field label="教室">
            <input
              type="text"
              value={form.classroom}
              onChange={(e) => update({ classroom: e.target.value })}
              disabled={pending}
              placeholder="例: 1号館 211"
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
            />
          </Field>
          <Field label="担当教員">
            <input
              type="text"
              value={form.teacher}
              onChange={(e) => update({ teacher: e.target.value })}
              disabled={pending}
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
            />
          </Field>
          <div className="flex gap-2">
            <Field label="開始">
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => update({ startTime: e.target.value })}
                disabled={pending}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
              />
            </Field>
            <Field label="終了">
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => update({ endTime: e.target.value })}
                disabled={pending}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
              />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={pending}
            className="flex-1 rounded-md bg-sky-500 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "保存中..." : "保存"}
          </button>
          {target.existing && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={pending}
              className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-600 dark:text-rose-300 disabled:opacity-50"
            >
              削除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs">
      <span className="block text-slate-600 dark:text-slate-400">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
