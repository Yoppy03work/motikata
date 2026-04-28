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
  { value: 1, label: "月", full: "月曜" },
  { value: 2, label: "火", full: "火曜" },
  { value: 3, label: "水", full: "水曜" },
  { value: 4, label: "木", full: "木曜" },
  { value: 5, label: "金", full: "金曜" },
  { value: 6, label: "土", full: "土曜" },
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

  // 今日の曜日(JST、月=1〜土=6 にマップ。日曜は 0 で対象外)
  const todayDow = useMemo(() => {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const d = jst.getUTCDay(); // 0=日, 1=月, ..., 6=土
    return d === 0 ? 0 : d;
  }, []);

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
      {error && (
        <p className="mb-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* 凡例 */}
      <div className="mb-2 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-200 dark:bg-sky-500/30" />
          授業
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-slate-400 dark:border-slate-600" />
          空き(タップで追加)
        </span>
        {todayDow >= 1 && todayDow <= 6 && (
          <span className="ml-auto text-sky-600 dark:text-sky-400">
            ▼ 今日
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-14 border-b border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-1.5 text-[10px] font-medium text-slate-500">
                時限
              </th>
              {DAYS.map((d) => {
                const isToday = d.value === todayDow;
                return (
                  <th
                    key={d.value}
                    className={`border-b border-slate-200 dark:border-slate-800 p-2 text-sm font-semibold ${
                      isToday
                        ? "bg-sky-100/70 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
                        : "bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1">
                      {d.label}
                      {isToday && (
                        <span aria-hidden className="text-[10px]">
                          ▼
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map((p, rowIdx) => {
              const isLastRow = rowIdx === PERIODS.length - 1;
              return (
                <tr key={p.value}>
                  <th
                    className={`sticky left-0 z-10 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-1.5 text-center align-top ${
                      isLastRow ? "" : "border-b"
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {p.value}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500 tabular-nums">
                      {p.start}
                    </div>
                  </th>
                  {DAYS.map((d) => {
                    const key = `${d.value}/${p.value}`;
                    if (occupied.has(key)) return null;
                    const it = startCells.get(key);
                    const span = it ? Math.max(1, it.endPeriod - it.period + 1) : 1;
                    const isToday = d.value === todayDow;
                    return (
                      <td
                        key={d.value}
                        rowSpan={span}
                        className={`align-top p-0 ${
                          isLastRow && span === 1 ? "" : "border-b border-slate-200 dark:border-slate-800"
                        } ${isToday ? "bg-sky-50/30 dark:bg-sky-500/[0.04]" : ""}`}
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
                          className={`block w-full text-left transition ${
                            it
                              ? "bg-sky-100/80 dark:bg-sky-500/15 hover:bg-sky-200 dark:hover:bg-sky-500/25 ring-1 ring-inset ring-sky-200 dark:ring-sky-500/30"
                              : "border border-dashed border-transparent hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900"
                          }`}
                          style={{ minHeight: `${span * 3.5}rem` }}
                        >
                          {it ? (
                            <div className="flex h-full flex-col p-2">
                              <div className="text-[10px] font-medium text-sky-700 dark:text-sky-300 tabular-nums">
                                {it.period}
                                {it.endPeriod !== it.period ? `-${it.endPeriod}` : ""}限
                              </div>
                              <div className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
                                {it.courseName}
                              </div>
                              {it.classroom && (
                                <div className="mt-auto pt-1 truncate text-[11px] text-slate-700 dark:text-slate-400">
                                  📍 {it.classroom}
                                </div>
                              )}
                              {it.teacher && (
                                <div className="truncate text-[10px] text-slate-500">
                                  {it.teacher}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex h-full items-center justify-center text-base text-slate-300 dark:text-slate-700">
                              +
                            </div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
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
            {day?.full} {target.existing ? "編集" : "追加"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            閉じる
          </button>
        </div>
        <div className="space-y-3">
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
          <p className="rounded-md bg-slate-100 dark:bg-slate-900 px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-400">
            時刻:{" "}
            <span className="tabular-nums font-medium">
              {form.startTime}〜{form.endTime}
            </span>
            <span className="ml-1 text-slate-500">(限の選択に合わせて自動設定)</span>
          </p>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={pending}
            className="flex-1 rounded-md bg-sky-500 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-sky-600"
          >
            {pending ? "保存中..." : "保存"}
          </button>
          {target.existing && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={pending}
              className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-600 dark:text-rose-300 disabled:opacity-50 hover:bg-rose-500/10"
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
