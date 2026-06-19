"use client";

import { useEffect, useState, useTransition } from "react";

type Priority = "LOW" | "MID" | "HIGH";
type Channel = "PUSH" | "SLACK";
type ReminderPreset = "none" | "at" | "m15" | "h1" | "d1";

// /settings で連携した Google カレンダーのうち enabled=true のもの。
// "送信先" ドロップダウンに並べる。
type GoogleCalendarOption = {
  id: number;
  summary: string;
  isPrimary: boolean;
  colorHex: string | null;
};

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
  // 日付は親(AddFabや日詳細シート)から prop で初期値を受け取り、
  // フォーム内で編集可能にする(以前は disabled で固定だった)
  const [date, setDate] = useState(ymd);
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
  // Google カレンダー連携 (Phase 4 + 5): 有効カレンダー一覧 + 選択中の id。
  // null = 「モチカタのみ」(googleCalendarId なし)。連携してない or 一覧
  // 取得失敗時はセレクタを描画しない (空配列で空表示)。
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarOption[]>([]);
  const [googleCalendarId, setGoogleCalendarId] = useState<number | null>(null);

  // ymd prop が変わった場合(モーダルを開き直したケース等)は date を追従させる
  useEffect(() => {
    setDate(ymd);
  }, [ymd]);

  // Google カレンダー連携状況の取得。マウント時に 1 度だけ。
  // 401 / 失敗時は空配列のまま (= セレクタ非表示)。
  useEffect(() => {
    let cancelled = false;
    fetch("/api/google/calendars", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { calendars: [] }))
      .then(
        (body: {
          calendars?: { id: number; summary: string; isPrimary: boolean; colorHex: string | null; enabled: boolean }[];
        }) => {
          if (cancelled) return;
          // 「送信先」候補は enabled なものに限定。
          // disabled なカレンダー (= 取り込まない設定にしているもの) に push
          // できると意図と食い違うため除外する。
          const list = (body.calendars ?? [])
            .filter((c) => c.enabled)
            .map(({ id, summary, isPrimary, colorHex }) => ({
              id,
              summary,
              isPrimary,
              colorHex,
            }));
          setGoogleCalendars(list);
        },
      )
      .catch(() => {
        if (!cancelled) setGoogleCalendars([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 日付/時刻が変わるたびに ±30分の重複をチェック
  useEffect(() => {
    if (!time || !date) return;
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      const dueAt = new Date(`${date}T${time}:00+09:00`);
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
  }, [date, time]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    if (!date) {
      setError("日付を入力してください");
      return;
    }
    const dueAt = `${date}T${time}:00+09:00`;
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
      // googleCalendarId が選ばれていれば POST /api/tasks 側で events.insert
      // を呼んで Google 側にも作る (Phase 4)。未選択なら従来通り MANUAL。
      ...(googleCalendarId !== null ? { googleCalendarId } : {}),
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
        // Phase 7: Google 失敗時 (502) は素直に message を出し、
        // "モチカタのみで再試行" の導線を添える。
        // body.error が string (Google failure path) と Zod object 両方ある。
        let msg: string;
        if (typeof body.error === "string") {
          msg = body.error;
        } else if (body.error && typeof body.error === "object") {
          msg = "入力に問題があります";
        } else {
          msg = "保存に失敗しました";
        }
        // 502 (Google insert 失敗) のときだけ retry hint を出す。
        // Phase 9: 500 は DB transaction 失敗 (Google は既に成功して rollback
        // 済み) なので、『モチカタのみに切り替えて再試行』しても DB 障害が
        // 解消するとは限らない。誤誘導になるので 500 では出さない。
        if (res.status === 502 && googleCalendarId !== null) {
          msg += "\n保存先を『モチカタのみ』に切り替えて再試行できます";
        }
        setError(msg);
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
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
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

      {googleCalendars.length > 0 && (
        <div>
          <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">
            保存先
          </label>
          <div className="flex flex-col gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 p-1.5">
            <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800">
              <input
                type="radio"
                name="save-target"
                checked={googleCalendarId === null}
                onChange={() => setGoogleCalendarId(null)}
                className="h-3.5 w-3.5"
              />
              <span>モチカタのみ</span>
            </label>
            {googleCalendars.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"
              >
                <input
                  type="radio"
                  name="save-target"
                  checked={googleCalendarId === c.id}
                  onChange={() => setGoogleCalendarId(c.id)}
                  className="h-3.5 w-3.5"
                />
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: c.colorHex ?? "#94a3b8" }}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate">
                  Google: {c.summary}
                  {c.isPrimary ? (
                    <span className="ml-1 text-[10px] text-sky-600 dark:text-sky-400">
                      (主)
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
            Google を選ぶとモチカタの保存と同時にカレンダーにも作成されます (失敗時は両方とも作成されません)
          </p>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="rounded-lg border border-slate-500/40 bg-slate-500/10 p-3 text-xs text-slate-200">
          <p className="font-medium">⚠️ ±30分以内に {conflicts.length} 件の予定/タスクがあります</p>
          <ul className="mt-1 space-y-0.5 text-slate-100/80">
            {conflicts.slice(0, 4).map((c) => (
              <li key={c.id}>
                ・{new Date(c.dueAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}{" "}
                {c.itemType === "EVENT" ? "[予定]" : "[タスク]"} {c.title}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-slate-300/70">
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

      {error && (
        <p className="whitespace-pre-line text-xs text-rose-400">{error}</p>
      )}

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
