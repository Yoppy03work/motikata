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

// 授業名から自動で割り当てるカード配色。
// Tailwind が JIT で拾えるよう、すべて static な class 文字列で記述。
// アクセシビリティ: 文字 vs 背景のコントラストが WCAG AA 4.5:1 を超えるよう、
// 背景は -100 系(薄い)、文字は -800 / dark は -200 を使う。
type Palette = {
  card: string; // bg + ring (light/dark)
  accent: string; // 左アクセントバー
  badge: string; // 限ラベル文字色
  hover: string;
};
const PALETTES: Palette[] = [
  {
    card: "bg-sky-100 ring-sky-300 dark:bg-sky-500/20 dark:ring-sky-500/40",
    accent: "bg-sky-500",
    badge: "text-sky-800 dark:text-sky-200",
    hover: "hover:bg-sky-200 dark:hover:bg-sky-500/30",
  },
  {
    card: "bg-violet-100 ring-violet-300 dark:bg-violet-500/20 dark:ring-violet-500/40",
    accent: "bg-violet-500",
    badge: "text-violet-800 dark:text-violet-200",
    hover: "hover:bg-violet-200 dark:hover:bg-violet-500/30",
  },
  {
    card: "bg-emerald-100 ring-emerald-300 dark:bg-emerald-500/20 dark:ring-emerald-500/40",
    accent: "bg-emerald-500",
    badge: "text-emerald-800 dark:text-emerald-200",
    hover: "hover:bg-emerald-200 dark:hover:bg-emerald-500/30",
  },
  {
    card: "bg-amber-100 ring-amber-300 dark:bg-amber-500/20 dark:ring-amber-500/40",
    accent: "bg-amber-500",
    badge: "text-amber-800 dark:text-amber-200",
    hover: "hover:bg-amber-200 dark:hover:bg-amber-500/30",
  },
  {
    card: "bg-rose-100 ring-rose-300 dark:bg-rose-500/20 dark:ring-rose-500/40",
    accent: "bg-rose-500",
    badge: "text-rose-800 dark:text-rose-200",
    hover: "hover:bg-rose-200 dark:hover:bg-rose-500/30",
  },
  {
    card: "bg-pink-100 ring-pink-300 dark:bg-pink-500/20 dark:ring-pink-500/40",
    accent: "bg-pink-500",
    badge: "text-pink-800 dark:text-pink-200",
    hover: "hover:bg-pink-200 dark:hover:bg-pink-500/30",
  },
  {
    card: "bg-indigo-100 ring-indigo-300 dark:bg-indigo-500/20 dark:ring-indigo-500/40",
    accent: "bg-indigo-500",
    badge: "text-indigo-800 dark:text-indigo-200",
    hover: "hover:bg-indigo-200 dark:hover:bg-indigo-500/30",
  },
  {
    card: "bg-teal-100 ring-teal-300 dark:bg-teal-500/20 dark:ring-teal-500/40",
    accent: "bg-teal-500",
    badge: "text-teal-800 dark:text-teal-200",
    hover: "hover:bg-teal-200 dark:hover:bg-teal-500/30",
  },
  {
    card: "bg-orange-100 ring-orange-300 dark:bg-orange-500/20 dark:ring-orange-500/40",
    accent: "bg-orange-500",
    badge: "text-orange-800 dark:text-orange-200",
    hover: "hover:bg-orange-200 dark:hover:bg-orange-500/30",
  },
  {
    card: "bg-cyan-100 ring-cyan-300 dark:bg-cyan-500/20 dark:ring-cyan-500/40",
    accent: "bg-cyan-500",
    badge: "text-cyan-800 dark:text-cyan-200",
    hover: "hover:bg-cyan-200 dark:hover:bg-cyan-500/30",
  },
];

function paletteFor(courseName: string): Palette {
  // FNV-1a 風の単純ハッシュで安定的に色を選ぶ
  let h = 0x811c9dc5;
  for (let i = 0; i < courseName.length; i++) {
    h ^= courseName.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return PALETTES[Math.abs(h) % PALETTES.length];
}

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
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-700 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-sky-200 dark:bg-sky-500/40" />
          授業
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-slate-500 dark:border-slate-500" />
          空き(タップで追加)
        </span>
      </div>

      <div
        className="overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
        role="grid"
        aria-label="時間割"
      >
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 w-12 border-b border-r border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 p-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300"
              >
                時限
              </th>
              {DAYS.map((d) => {
                const isToday = d.value === todayDow;
                return (
                  <th
                    key={d.value}
                    scope="col"
                    // aria-current は a11y のために残す(視覚的には他と同じ)
                    aria-current={isToday ? "date" : undefined}
                    className="border-b border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 p-2 text-base font-bold text-slate-800 dark:text-slate-200"
                  >
                    {d.label}
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
                    scope="row"
                    className={`sticky left-0 z-10 bg-slate-100 dark:bg-slate-900 border-r border-slate-300 dark:border-slate-700 px-1 py-1 text-center align-middle ${
                      isLastRow ? "" : "border-b"
                    }`}
                  >
                    <div className="text-sm font-bold text-slate-800 dark:text-slate-200 tabular-nums leading-tight">
                      {p.value}
                    </div>
                    <div className="text-[10px] font-medium text-slate-600 dark:text-slate-400 tabular-nums leading-tight">
                      {p.start}
                    </div>
                  </th>
                  {DAYS.map((d) => {
                    const key = `${d.value}/${p.value}`;
                    if (occupied.has(key)) return null;
                    const it = startCells.get(key);
                    const span = it ? Math.max(1, it.endPeriod - it.period + 1) : 1;
                    const palette = it ? paletteFor(it.courseName) : null;
                    const dayLabel = DAYS.find((x) => x.value === d.value)?.full ?? "";
                    const periodLabel =
                      it && it.endPeriod !== it.period
                        ? `${it.period}-${it.endPeriod}限`
                        : `${p.value}限`;
                    const aria = it
                      ? `${dayLabel} ${periodLabel} ${it.courseName}${it.classroom ? ` 教室 ${it.classroom}` : ""}${it.teacher ? ` 担当 ${it.teacher}` : ""}。タップで編集`
                      : `${dayLabel} ${p.value}限 空き。タップで追加`;
                    return (
                      <td
                        key={d.value}
                        rowSpan={span}
                        role="gridcell"
                        className="p-1 align-top"
                      >
                        <button
                          type="button"
                          aria-label={aria}
                          onClick={() =>
                            setEditing({
                              dayOfWeek: d.value,
                              period: p.value,
                              existing: it ?? null,
                            })
                          }
                          className={`relative flex h-full w-full overflow-hidden rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950 motion-safe:transition motion-safe:active:scale-[0.98] ${
                            it && palette
                              ? `${palette.card} ${palette.hover} ring-1 ring-inset shadow-sm hover:shadow-md`
                              : "border border-dashed border-slate-400 dark:border-slate-600 hover:border-sky-600 dark:hover:border-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10"
                          }`}
                          style={{ minHeight: `${span * 3}rem` }}
                        >
                          {it && palette ? (
                            <>
                              {/* 左アクセントバー */}
                              <span
                                className={`absolute left-0 top-0 h-full w-1 ${palette.accent}`}
                                aria-hidden
                              />
                              <div className="flex w-full flex-col gap-0.5 px-2 py-1.5 pl-2.5">
                                <div
                                  className={`flex items-baseline gap-1 text-[11px] font-bold tabular-nums ${palette.badge}`}
                                >
                                  <span>{periodLabel}</span>
                                  <span aria-hidden className="text-slate-400 dark:text-slate-500">
                                    ·
                                  </span>
                                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                                    {it.startTime}〜{it.endTime}
                                  </span>
                                </div>
                                <div className="line-clamp-2 text-[15px] font-bold leading-tight text-slate-900 dark:text-slate-50">
                                  {it.courseName}
                                </div>
                                {it.classroom && (
                                  <div className="mt-auto truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                                    <span aria-hidden>📍 </span>
                                    {it.classroom}
                                  </div>
                                )}
                                {it.teacher && (
                                  <div className="truncate text-[11px] font-medium text-slate-600 dark:text-slate-300">
                                    {it.teacher}
                                  </div>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <span aria-hidden className="text-base text-slate-400 dark:text-slate-500">
                                +
                              </span>
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
