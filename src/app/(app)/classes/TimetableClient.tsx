"use client";

// 時間割マスター(ClassSchedule)の編集 UI。
// CIT は 9:00 から 1 時間刻みの 10 限制。1コマ = 1〜複数限の連続。
// グリッド: 月-土 × 1-10限。複数限の授業は rowspan で連続セル占有。

import { useCallback, useEffect, useMemo, useState } from "react";

type Item = {
  id: number;
  dayOfWeek: number;
  period: number;
  endPeriod: number;
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

// 1限〜10限の標準時刻(9:00-19:00 1時間刻み)
const PERIODS: { value: number; start: string; end: string }[] = Array.from(
  { length: 10 },
  (_, i) => {
    const startHour = 9 + i;
    const endHour = startHour + 1;
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      value: i + 1,
      start: `${pad(startHour)}:00`,
      end: `${pad(endHour)}:00`,
    };
  },
);

type EditTarget = {
  dayOfWeek: number;
  period: number;
  existing: Item | null;
};

type FormState = {
  courseName: string;
  classroom: string;
  teacher: string;
  startPeriod: number;
  endPeriod: number;
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

  // (dayOfWeek, period) → Item の引き当て + 占有判定
  // - startCells: そのセルが授業の開始セル(rowspan で出力する元)
  // - occupied: そのセルがすでに別授業に占有されている(td 自体出力しない)
  const { startCells, occupied } = useMemo(() => {
    const startCells = new Map<string, Item>();
    const occupied = new Set<string>();
    for (const it of items) {
      const start = it.period;
      const end = Math.max(start, it.endPeriod);
      startCells.set(`${it.dayOfWeek}/${start}`, it);
      for (let p = start + 1; p <= end; p++) {
        occupied.add(`${it.dayOfWeek}/${p}`);
      }
    }
    return { startCells, occupied };
  }, [items]);

  return (
    <div>
      {error && <p className="mb-2 text-xs text-rose-500">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="w-12 border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 p-1 text-slate-600 dark:text-slate-400">
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
                </th>
                {DAYS.map((d) => {
                  const key = `${d.value}/${p.value}`;
                  if (occupied.has(key)) return null; // 上の行から rowspan で覆われている
                  const it = startCells.get(key);
                  const span = it ? Math.max(1, it.endPeriod - it.period + 1) : 1;
                  return (
                    <td
                      key={d.value}
                      rowSpan={span}
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
                        className={`block w-full p-1.5 text-left transition ${
                          it
                            ? "bg-sky-100 dark:bg-sky-500/10 hover:bg-sky-200 dark:hover:bg-sky-500/20"
                            : "hover:bg-slate-100 dark:hover:bg-slate-900"
                        }`}
                        style={{ minHeight: `${span * 3}rem` }}
                      >
                        {it ? (
                          <>
                            <div className="text-[10px] text-slate-500">
                              {it.period}
                              {it.endPeriod !== it.period ? `-${it.endPeriod}` : ""}限
                            </div>
                            <div className="mt-0.5 truncate text-[11px] font-medium text-slate-900 dark:text-slate-100">
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
  const day = DAYS.find((d) => d.value === target.dayOfWeek);
  const initial: FormState = useMemo(() => {
    const start = target.existing?.period ?? target.period;
    const end = target.existing?.endPeriod ?? target.period;
    return {
      courseName: target.existing?.courseName ?? "",
      classroom: target.existing?.classroom ?? "",
      teacher: target.existing?.teacher ?? "",
      startPeriod: start,
      endPeriod: end,
      startTime:
        target.existing?.startTime ??
        PERIODS[start - 1]?.start ??
        "09:00",
      endTime:
        target.existing?.endTime ??
        PERIODS[end - 1]?.end ??
        "10:00",
    };
  }, [target]);
  const [form, setForm] = useState<FormState>(initial);

  // 開始/終了限が変わったら時刻も自動同期
  const update = (patch: Partial<FormState>) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      if ("startPeriod" in patch || "endPeriod" in patch) {
        const sp = next.startPeriod;
        const ep = Math.max(sp, next.endPeriod);
        next.endPeriod = ep;
        next.startTime = PERIODS[sp - 1]?.start ?? next.startTime;
        next.endTime = PERIODS[ep - 1]?.end ?? next.endTime;
      }
      return next;
    });

  const save = async () => {
    if (!form.courseName.trim()) {
      setError("授業名を入力してください");
      return;
    }
    if (form.endPeriod < form.startPeriod) {
      setError("終了限は開始限以上にしてください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body = {
        dayOfWeek: target.dayOfWeek,
        period: form.startPeriod,
        endPeriod: form.endPeriod,
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
            {day?.label}曜 {target.existing ? "編集" : "追加"}
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
          <div className="flex gap-2">
            <Field label="開始限">
              <select
                value={form.startPeriod}
                onChange={(e) => update({ startPeriod: Number(e.target.value) })}
                disabled={pending}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
              >
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.value}限 ({p.start})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="終了限">
              <select
                value={form.endPeriod}
                onChange={(e) => update({ endPeriod: Number(e.target.value) })}
                disabled={pending}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
              >
                {PERIODS.filter((p) => p.value >= form.startPeriod).map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.value}限 ({p.end})
                  </option>
                ))}
              </select>
            </Field>
          </div>
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
          <p className="text-[10px] text-slate-500">
            時刻: <span className="tabular-nums">{form.startTime}〜{form.endTime}</span>
            (限の選択に合わせて自動設定)
          </p>
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
