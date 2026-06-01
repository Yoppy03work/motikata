"use client";

// 時間割マスター(ClassSchedule)の編集 UI。
// CIT は 9:00 から 1 時間刻みの 10 限制。1コマ = 1〜複数限の連続。
// グリッド: 月-土 × 1-10限。複数限の授業は rowspan で連続セル占有。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  effectiveFrom: string | null;
  effectiveTo: string | null;
  // ユーザ指定のカード色 (hex)。null は科目名ハッシュで自動配色。
  color: string | null;
};

type Semester = "first" | "second";

// JST の現在日付から前期/後期を判定。
// 前期: 4-9月、後期: 10-3月。
function semesterOfNow(): Semester {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const month = jst.getUTCMonth() + 1; // 1-12
  return month >= 4 && month <= 9 ? "first" : "second";
}

// effectiveFrom (UTC ISO) から、これが前期/後期のどちらか判定。
// effectiveFrom が無い(手動入力等)なら all 扱い(全期間表示)。
function semesterOfItem(it: Item): Semester | "unknown" {
  if (!it.effectiveFrom) return "unknown";
  const from = new Date(it.effectiveFrom);
  const jstMonth =
    new Date(from.getTime() + 9 * 60 * 60 * 1000).getUTCMonth() + 1;
  return jstMonth >= 4 && jstMonth <= 9 ? "first" : "second";
}

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
// 色は3色に統一: sky(主) / slate(中性) / rose(警告)。
// 授業ごとの差は背景の濃淡(同じ sky 系で 3 段階)で表現。
const PALETTES: Palette[] = [
  {
    card: "bg-sky-100 ring-sky-300 dark:bg-sky-500/20 dark:ring-sky-500/40",
    accent: "bg-sky-500",
    badge: "text-sky-800 dark:text-sky-200",
    hover: "hover:bg-sky-200 dark:hover:bg-sky-500/30",
  },
  {
    card: "bg-slate-200 ring-slate-400 dark:bg-slate-700/40 dark:ring-slate-600",
    accent: "bg-slate-500",
    badge: "text-slate-800 dark:text-slate-200",
    hover: "hover:bg-slate-300 dark:hover:bg-slate-700/60",
  },
  {
    card: "bg-rose-100 ring-rose-300 dark:bg-rose-500/20 dark:ring-rose-500/40",
    accent: "bg-rose-500",
    badge: "text-rose-800 dark:text-rose-200",
    hover: "hover:bg-rose-200 dark:hover:bg-rose-500/30",
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
  // null = 自動配色(科目名ハッシュ)、文字列(#RRGGBB) = ユーザ指定
  color: string | null;
};

// プリセットカラーパレット(20色)。色相を一周しつつ似た色は除外。
// "自動と同色" 印の 3 色は自動配色 (paletteFor) と同じ hex なので、
// 自動で割り当てられる色を意図的に選び直したい時に使える。
const PRESET_COLORS: { hex: string; name: string }[] = [
  { hex: "#ef4444", name: "赤" },
  { hex: "#f97316", name: "橙" },
  { hex: "#eab308", name: "黄" },
  { hex: "#84cc16", name: "黄緑" },
  { hex: "#22c55e", name: "緑" },
  { hex: "#10b981", name: "翠" },
  { hex: "#14b8a6", name: "青緑" },
  { hex: "#06b6d4", name: "シアン" },
  { hex: "#0ea5e9", name: "空(自動と同色)" },
  { hex: "#3b82f6", name: "青" },
  { hex: "#6366f1", name: "藍" },
  { hex: "#a855f7", name: "紫" },
  { hex: "#d946ef", name: "桃紫" },
  { hex: "#ec4899", name: "桃" },
  { hex: "#f43f5e", name: "薔薇(自動と同色)" },
  { hex: "#92400e", name: "茶" },
  { hex: "#166534", name: "暗緑" },
  { hex: "#1e293b", name: "黒紺" },
  { hex: "#6b7280", name: "灰" },
  { hex: "#64748b", name: "青灰(自動と同色)" },
];

// hex を {r,g,b} に分解。失敗時は null。
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace("#", "").match(/^([0-9a-fA-F]{6})$|^([0-9a-fA-F]{3})$/);
  if (!m) return null;
  if (m[1]) {
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
    };
  }
  return {
    r: parseInt(m[2][0] + m[2][0], 16),
    g: parseInt(m[2][1] + m[2][1], 16),
    b: parseInt(m[2][2] + m[2][2], 16),
  };
}

function rgbToCss({ r, g, b }: { r: number; g: number; b: number }): string {
  const h = (c: number) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// hex を白方向に ratio (0..1) ぶん寄せた色を返す。
// ratio=0.75 で sky-500 → sky-100 相当(オリジナルのカード背景に近い)。
function lightenHex(hex: string, ratio: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const blend = (v: number) => Math.round(v + (255 - v) * ratio);
  return rgbToCss({ r: blend(c.r), g: blend(c.g), b: blend(c.b) });
}

// hex を黒方向に ratio (0..1) ぶん寄せた色を返す。
// ratio=0.5 で sky-400 → sky-800 相当(オリジナルのバッジ文字色に近い)。
function darkenHex(hex: string, ratio: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const blend = (v: number) => Math.round(v * (1 - ratio));
  return rgbToCss({ r: blend(c.r), g: blend(c.g), b: blend(c.b) });
}

// hex から相対輝度を計算してテキスト色を決める。
// 明るい背景には濃いテキスト、暗い背景には淡いテキスト。
function readableTextColor(hex: string): string {
  const c = parseHex(hex);
  if (!c) return "#0f172a";
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // 0..255
  return lum > 140 ? "#0f172a" : "#f8fafc";
}

export function TimetableClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  // 講義カード長押しで開く詳細表示(読み取り専用)
  const [viewing, setViewing] = useState<Item | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 学期切替。デフォルトは今日の日付に応じて自動選択。
  const [semester, setSemester] = useState<Semester>(() => semesterOfNow());

  // 今日の曜日(JST、月=1〜土=6 にマップ。日曜は 0 で対象外)
  const todayDow = useMemo(() => {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const d = jst.getUTCDay(); // 0=日, 1=月, ..., 6=土
    return d === 0 ? 0 : d;
  }, []);

  // 学期フィルタ済みアイテム。
  // 前期/後期 の2択。effectiveFrom が null のものは両方の学期に表示する
  // (手動入力された授業など。学期境界が無いので暦に依存させない方針)。
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      const s = semesterOfItem(it);
      return s === "unknown" || s === semester;
    });
  }, [items, semester]);

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

  // (dayOfWeek, period) → Item の引き当て + 占有判定。
  // 学期フィルタ後のアイテムだけ対象にする(以前は全期混在で同じセルに前期+後期が
  // 重なって片方しか表示されない不具合があった)。
  const { startCells, occupied } = useMemo(() => {
    const startCells = new Map<string, Item>();
    const occupied = new Set<string>();
    for (const it of filteredItems) {
      const start = it.period;
      const end = Math.max(start, it.endPeriod);
      startCells.set(`${it.dayOfWeek}/${start}`, it);
      for (let p = start + 1; p <= end; p++) {
        occupied.add(`${it.dayOfWeek}/${p}`);
      }
    }
    return { startCells, occupied };
  }, [filteredItems]);

  return (
    <div>
      {error && (
        <p className="mb-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* 学期切替(前期 / 後期) */}
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg border border-slate-300 bg-white p-1 text-xs dark:border-slate-700 dark:bg-slate-950">
        {(
          [
            { v: "first" as const, label: "前期" },
            { v: "second" as const, label: "後期" },
          ]
        ).map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => setSemester(opt.v)}
            aria-pressed={semester === opt.v}
            className={`rounded-md px-2 py-1 transition ${
              semester === opt.v
                ? "bg-sky-500 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

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
                className="sticky left-0 z-10 w-14 border-b border-r border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 p-1 text-xs font-semibold text-slate-700 dark:text-slate-300"
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
                    <div className="text-base font-bold text-slate-800 dark:text-slate-200 tabular-nums leading-tight">
                      {p.value}
                    </div>
                    <div className="text-xs font-medium text-slate-600 dark:text-slate-400 tabular-nums leading-tight">
                      {p.start}
                    </div>
                  </th>
                  {DAYS.map((d) => {
                    const key = `${d.value}/${p.value}`;
                    if (occupied.has(key)) return null;
                    const it = startCells.get(key);
                    const span = it ? Math.max(1, it.endPeriod - it.period + 1) : 1;
                    return (
                      <td
                        key={d.value}
                        rowSpan={span}
                        role="gridcell"
                        className="p-1 align-top"
                      >
                        <ClassCell
                          item={it ?? null}
                          dayOfWeek={d.value}
                          period={p.value}
                          span={span}
                          onTap={() =>
                            setEditing({
                              dayOfWeek: d.value,
                              period: p.value,
                              existing: it ?? null,
                            })
                          }
                          onLongPress={() => {
                            if (it) setViewing(it);
                          }}
                        />
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

      {viewing && (
        <DetailsModal
          item={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing({
              dayOfWeek: viewing.dayOfWeek,
              period: viewing.period,
              existing: viewing,
            });
            setViewing(null);
          }}
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
      color: target.existing?.color ?? null,
    };
  }, [target]);
  const [form, setForm] = useState<FormState>(initial);
  // 持ち物 (ChecklistTemplate) — ClassSchedule の id があるときだけ管理可
  const [items, setItems] = useState<string[]>([""]);
  const [itemsLoaded, setItemsLoaded] = useState(false);

  // 既存 schedule の場合は持ち物テンプレを取得
  useEffect(() => {
    if (!target.existing) {
      setItemsLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/classes/${target.existing!.id}/items`);
        if (!res.ok) {
          setItemsLoaded(true);
          return;
        }
        const body = await res.json();
        if (cancelled) return;
        const labels: string[] = (body.items ?? []).map(
          (it: { label: string }) => it.label,
        );
        setItems(labels.length > 0 ? labels : [""]);
      } finally {
        if (!cancelled) setItemsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

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
        color: form.color,
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
      const json = await res.json().catch(() => ({}));
      const classId = target.existing?.id ?? json.item?.id;

      // 持ち物テンプレも保存(空白行は除外)
      if (classId) {
        const cleaned = items
          .map((s) => s.trim())
          .filter(Boolean)
          .map((label, i) => ({ label, orderIdx: i }));
        const itemsRes = await fetch(`/api/classes/${classId}/items`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: cleaned }),
        });
        if (!itemsRes.ok) {
          setError(`持ち物の保存に失敗 (${itemsRes.status})`);
          return;
        }
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
      {/* 20色パレット追加でモーダルが縦に伸び、低い画面/キーボード表示時に
          下部の持ち物・保存ボタンが画面外に出るので、最大高を制限して
          中身をスクロールできるようにする(dvh = iOS Safari のツールバー考慮)。 */}
      <div
        className="flex max-h-[90dvh] w-full max-w-sm flex-col overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 shadow-xl"
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
          {/* カード色: 20色のプリセット + 自動。null = 自動配色(科目名ハッシュ)。 */}
          <Field label="カード色">
            <div className="grid grid-cols-10 gap-1.5">
              {/* 自動(null) */}
              <button
                type="button"
                onClick={() => update({ color: null })}
                disabled={pending}
                aria-label="自動配色"
                aria-pressed={form.color === null}
                className={`relative flex aspect-square items-center justify-center rounded-md border text-[10px] font-medium transition disabled:opacity-50 ${
                  form.color === null
                    ? "border-sky-500 bg-sky-50 text-sky-700 ring-2 ring-sky-500 dark:bg-sky-500/15 dark:text-sky-200"
                    : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                }`}
                title="科目名から自動配色"
              >
                自動
              </button>
              {PRESET_COLORS.map((c) => {
                const selected = form.color?.toLowerCase() === c.hex.toLowerCase();
                return (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => update({ color: c.hex })}
                    disabled={pending}
                    aria-label={`${c.name} (${c.hex})`}
                    aria-pressed={selected}
                    title={`${c.name} ${c.hex}`}
                    className={`relative aspect-square rounded-md transition disabled:opacity-50 ${
                      selected
                        ? "ring-2 ring-offset-2 ring-slate-700 ring-offset-white dark:ring-slate-300 dark:ring-offset-slate-950 scale-110"
                        : "ring-1 ring-inset ring-slate-300/60 hover:scale-105 dark:ring-slate-700/60"
                    }`}
                    style={{ background: c.hex }}
                  >
                    {selected && (
                      <span
                        aria-hidden
                        className="absolute inset-0 flex items-center justify-center text-sm font-bold"
                        style={{ color: readableTextColor(c.hex) }}
                      >
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <span className="mt-1 block text-[11px] text-slate-500">
              {form.color
                ? `選択中: ${PRESET_COLORS.find((c) => c.hex.toLowerCase() === form.color?.toLowerCase())?.name ?? form.color}`
                : "「自動」: 科目名から sky/slate/rose の3色を自動割当"}
            </span>
          </Field>
          <p className="rounded-md bg-slate-100 dark:bg-slate-900 px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-400">
            時刻:{" "}
            <span className="tabular-nums font-medium">
              {form.startTime}〜{form.endTime}
            </span>
            <span className="ml-1 text-slate-500">(限の選択に合わせて自動設定)</span>
          </p>

          {/* 持ち物テンプレ */}
          <div>
            <span className="block text-xs text-slate-600 dark:text-slate-400">
              持ち物(毎朝、その日の授業に展開されます)
            </span>
            {!itemsLoaded ? (
              <p className="mt-1 text-[11px] text-slate-500">読み込み中…</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {items.map((line, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={line}
                      onChange={(e) => {
                        const next = [...items];
                        next[i] = e.target.value;
                        setItems(next);
                      }}
                      disabled={pending}
                      placeholder="例: 教科書 / 関数電卓 / レポート用紙"
                      className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        setItems(items.filter((_, j) => j !== i).length === 0 ? [""] : items.filter((_, j) => j !== i))
                      }
                      aria-label="削除"
                      className="rounded-md px-2 py-1 text-xs text-slate-500 hover:text-rose-500"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => setItems([...items, ""])}
              className="mt-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline"
            >
              + 行を追加
            </button>
          </div>
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

// 講義カード(セル本体)。タップ=編集、長押し=詳細を呼び出す。
// item が null なら空セル(タップで追加)。
function ClassCell({
  item,
  dayOfWeek,
  period,
  span,
  onTap,
  onLongPress,
}: {
  item: Item | null;
  dayOfWeek: number;
  period: number;
  span: number;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const startCoord = useRef<{ x: number; y: number } | null>(null);

  const cancelTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    longPressed.current = false;
    startCoord.current = { x: e.clientX, y: e.clientY };
    cancelTimer();
    if (item) {
      // 既存セルのみ長押し有効。空セルは即タップで追加なのでタイマー不要。
      timer.current = setTimeout(() => {
        longPressed.current = true;
        timer.current = null;
        onLongPress();
      }, 500);
    }
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!timer.current || !startCoord.current) return;
    const dx = Math.abs(e.clientX - startCoord.current.x);
    const dy = Math.abs(e.clientY - startCoord.current.y);
    if (dx > 10 || dy > 10) cancelTimer();
  };
  const handlePointerUp = () => {
    cancelTimer();
  };
  const handleClick = () => {
    if (longPressed.current) {
      // 直前の長押しでモーダル開いたので click は無視
      longPressed.current = false;
      return;
    }
    onTap();
  };

  const dayLabel = DAYS.find((x) => x.value === dayOfWeek)?.full ?? "";
  const periodLabel = item
    ? item.endPeriod !== item.period
      ? `${item.period}-${item.endPeriod}限`
      : `${period}限`
    : `${period}限`;
  const aria = item
    ? `${dayLabel} ${periodLabel} ${item.courseName}${item.classroom ? ` 教室 ${item.classroom}` : ""}${item.teacher ? ` 担当 ${item.teacher}` : ""}。タップで編集、長押しで詳細`
    : `${dayLabel} ${period}限 空き。タップで追加`;

  if (!item) {
    return (
      <button
        type="button"
        aria-label={aria}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerMove={handlePointerMove}
        onContextMenu={(e) => e.preventDefault()}
        className="relative flex h-full w-full overflow-hidden rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950 motion-safe:transition motion-safe:active:scale-[0.98] border border-dashed border-slate-400 dark:border-slate-600 hover:border-sky-600 dark:hover:border-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10"
        style={{ minHeight: `${span * 3.5}rem` }}
      >
        <div className="flex h-full w-full items-center justify-center">
          <span aria-hidden className="text-lg text-slate-400 dark:text-slate-500">
            +
          </span>
        </div>
      </button>
    );
  }

  // ユーザ指定色 or 科目名ハッシュの自動配色。
  // カスタム色:
  //   - 背景 = 白方向に 75% 寄せた色(sky-100 相当の薄さ)
  //   - 左アクセントバー = 選択色そのまま(濃い)
  //   - 時限/時刻バッジ = 選択色を 50% 黒方向に寄せた色(sky-800 相当の濃さ)
  //   - 科目名 = ニュートラルな読みやすい色(白/黒、背景輝度から自動)
  //   - 教室・教員 = 同じく自動だが透明度を下げる
  // オリジナル(palette)も同じ「左濃い・背景薄い」の構造。
  const customColor = item.color;
  const palette = customColor ? null : paletteFor(item.courseName);
  const customBg = customColor ? lightenHex(customColor, 0.75) : null;
  const customText = customBg ? readableTextColor(customBg) : undefined;
  const customBadge = customColor ? darkenHex(customColor, 0.5) : undefined;

  return (
    <button
      type="button"
      aria-label={aria}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerMove={handlePointerMove}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex h-full w-full overflow-hidden rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950 motion-safe:transition motion-safe:active:scale-[0.98] ring-1 ring-inset shadow-sm hover:shadow-md select-none ${
        palette ? `${palette.card} ${palette.hover}` : ""
      }`}
      style={{
        minHeight: `${span * 3.5}rem`,
        ...(customBg
          ? { background: customBg, color: customText }
          : {}),
      }}
    >
      {/* 左アクセントバー: パレット時は class、カスタム時は inline で濃い色 */}
      <span
        className={`absolute left-0 top-0 h-full w-1 ${palette ? palette.accent : ""}`}
        style={customColor ? { background: customColor } : undefined}
        aria-hidden
      />
      <div className="flex w-full flex-col gap-0.5 px-2 py-1.5 pl-2.5">
        <div
          className={`flex items-baseline gap-1 text-xs font-bold tabular-nums ${
            palette ? palette.badge : ""
          }`}
          style={customBadge ? { color: customBadge } : undefined}
        >
          <span>{periodLabel}</span>
          <span aria-hidden className="opacity-60">·</span>
          <span className="font-semibold opacity-90">
            {item.startTime}〜{item.endTime}
          </span>
        </div>
        <div
          className={`line-clamp-2 text-base font-bold leading-tight ${
            palette ? "text-slate-900 dark:text-slate-50" : ""
          }`}
          style={customText ? { color: customText } : undefined}
        >
          {item.courseName}
        </div>
        {item.classroom && (
          <div
            className={`mt-auto truncate text-sm font-medium ${
              palette ? "text-slate-800 dark:text-slate-200" : ""
            }`}
            style={customText ? { color: customText, opacity: 0.9 } : undefined}
          >
            {item.classroom}
          </div>
        )}
        {item.teacher && (
          <div
            className={`truncate text-xs font-medium ${
              palette ? "text-slate-600 dark:text-slate-300" : ""
            }`}
            style={customText ? { color: customText, opacity: 0.75 } : undefined}
          >
            {item.teacher}
          </div>
        )}
      </div>
    </button>
  );
}

// 講義詳細モーダル(読み取り専用)。長押しから開く。
function DetailsModal({
  item,
  onClose,
  onEdit,
}: {
  item: Item;
  onClose: () => void;
  onEdit: () => void;
}) {
  const day = DAYS.find((d) => d.value === item.dayOfWeek);
  const periodLabel =
    item.endPeriod !== item.period
      ? `${item.period}限〜${item.endPeriod}限`
      : `${item.period}限`;
  const semester =
    item.effectiveFrom &&
    new Date(
      new Date(item.effectiveFrom).getTime() + 9 * 3600 * 1000,
    ).getUTCMonth() +
      1 >=
      4 &&
    new Date(
      new Date(item.effectiveFrom).getTime() + 9 * 3600 * 1000,
    ).getUTCMonth() +
      1 <=
      9
      ? "前期"
      : item.effectiveFrom
        ? "後期"
        : "—";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="class-details-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" />
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2
            id="class-details-title"
            className="min-w-0 truncate text-lg font-semibold"
          >
            {item.courseName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            閉じる
          </button>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">曜日 / 時限</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">
              {day?.full ?? `Day${item.dayOfWeek}`} / {periodLabel}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">時刻</dt>
            <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
              {item.startTime} 〜 {item.endTime}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">学期</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">
              {semester}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">教室</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">
              {item.classroom ?? "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">教員</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">
              {item.teacher ?? "—"}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 text-sm text-slate-700 dark:text-slate-300"
          >
            閉じる
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 rounded-md bg-sky-500 py-2 text-sm font-medium text-white"
          >
            編集
          </button>
        </div>
      </div>
    </div>
  );
}
