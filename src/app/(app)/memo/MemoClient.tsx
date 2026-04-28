"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ja } from "date-fns/locale/ja";
import { APP_TZ } from "@/lib/tz";

type Tab = "inbox" | "diary" | "stream";

type Note = {
  id: number;
  body: string;
  kind: "INBOX" | "DIARY";
  diaryDate: string | null;
  archivedAt: string | null;
  promotedTaskId: number | null;
  createdAt: string;
  updatedAt: string;
};

const tabs: { key: Tab; label: string; caption: string }[] = [
  { key: "inbox", label: "Inbox", caption: "未消化の思いつき" },
  { key: "diary", label: "日次", caption: "今日の日記メモ" },
  { key: "stream", label: "ストリーム", caption: "時系列すべて" },
];

export function MemoClient() {
  const [tab, setTab] = useState<Tab>("inbox");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [includeArchived, setIncludeArchived] = useState(false);

  const todayStr = useMemo(() => {
    // 「今日」はアプリ全体で JST 基準。クライアントの local TZ に左右されないよう
    // 明示的に JST で日付化する。
    return formatInTimeZone(new Date(), APP_TZ, "yyyy-MM-dd");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams({ tab });
    if (tab === "diary") q.set("date", todayStr);
    if (tab === "inbox" && includeArchived) q.set("includeArchived", "true");
    const res = await fetch(`/api/memo?${q}`);
    if (res.ok) {
      const { notes } = await res.json();
      setNotes(notes);
    }
    setLoading(false);
  }, [tab, todayStr, includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = () => {
    if (!draft.trim()) return;
    const body = draft;
    const kind: "INBOX" | "DIARY" = tab === "diary" ? "DIARY" : "INBOX";
    const diaryDate = kind === "DIARY" ? todayStr : undefined;
    startTransition(async () => {
      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, kind, diaryDate }),
      });
      if (res.ok) {
        setDraft("");
        void load();
      }
    });
  };

  const archive = (id: number, archived: boolean) => {
    startTransition(async () => {
      await fetch(`/api/memo/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      void load();
    });
  };

  const remove = (id: number) => {
    if (!confirm("削除しますか?")) return;
    startTransition(async () => {
      await fetch(`/api/memo/${id}`, { method: "DELETE" });
      void load();
    });
  };

  const current = tabs.find((t) => t.key === tab)!;

  return (
    <main className="px-4 pt-6 pb-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">メモ</h1>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{current.caption}</p>
      </header>

      <div role="tablist" className="mb-4 flex gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-lg py-1.5 text-sm transition ${
              tab === t.key
                ? "bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== "stream" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mb-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-3"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder={
              tab === "inbox"
                ? "思いついたこと…(あとでタスクに昇格)"
                : "今日のメモ…"
            }
            className="w-full resize-none bg-transparent text-sm placeholder-slate-500 outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">
              {tab === "inbox" ? "Inbox に追加されます" : `${todayStr} の日次メモに追加`}
            </span>
            <button
              type="submit"
              disabled={pending || !draft.trim()}
              className="rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              追加
            </button>
          </div>
        </form>
      )}

      {tab === "inbox" && (
        <label className="mb-3 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="h-4 w-4 accent-sky-500"
          />
          アーカイブ済も表示
        </label>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">読み込み中…</p>
      ) : notes.length === 0 ? (
        <p className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 p-4 text-sm text-slate-600 dark:text-slate-400">
          {tab === "inbox"
            ? "Inbox は空です。思いついたことを気軽に放り込んでください"
            : tab === "diary"
              ? "今日の日次メモはまだありません"
              : "メモはまだありません"}
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              tab={tab}
              onArchive={() => archive(n.id, !n.archivedAt)}
              onDelete={() => remove(n.id)}
              onPromoted={() => void load()}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function NoteRow({
  note,
  tab,
  onArchive,
  onDelete,
  onPromoted,
}: {
  note: Note;
  tab: Tab;
  onArchive: () => void;
  onDelete: () => void;
  onPromoted: () => void;
}) {
  const archived = !!note.archivedAt;
  const promoted = !!note.promotedTaskId;
  const [promoteOpen, setPromoteOpen] = useState(false);
  // 既定: 今日 23:59 (JST)
  const defaultYmd = formatInTimeZone(new Date(), APP_TZ, "yyyy-MM-dd");
  const [dueDate, setDueDate] = useState<string>(defaultYmd);
  const [dueTime, setDueTime] = useState<string>("23:59");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promote = async () => {
    setPending(true);
    setError(null);
    try {
      const dueAt = `${dueDate}T${dueTime}:00+09:00`;
      const res = await fetch(`/api/memo/${note.id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : `失敗 (${res.status})`);
        return;
      }
      setPromoteOpen(false);
      onPromoted();
    } finally {
      setPending(false);
    }
  };

  return (
    <li
      className={`rounded-xl border p-3 ${
        archived
          ? "border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/40 opacity-60"
          : note.kind === "DIARY"
            ? "border-violet-900/40 bg-violet-950/20"
            : "border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900"
      }`}
    >
      <p className={`whitespace-pre-wrap text-sm ${archived ? "line-through" : ""}`}>
        {note.body}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>
          {formatInTimeZone(new Date(note.createdAt), APP_TZ, "M/d HH:mm", { locale: ja })}
          {tab === "stream" && (
            <span className="ml-2 rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5">
              {note.kind === "INBOX" ? "Inbox" : "日次"}
            </span>
          )}
          {promoted && (
            <span className="ml-2 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 px-1.5 py-0.5">
              ✓ タスク化済
            </span>
          )}
        </span>
        <div className="flex gap-2">
          {!promoted && note.kind === "INBOX" && !archived && (
            <button
              onClick={() => setPromoteOpen((v) => !v)}
              className="text-sky-600 dark:text-sky-400 hover:underline"
            >
              タスク化
            </button>
          )}
          {note.kind === "INBOX" && (
            <button
              onClick={onArchive}
              className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            >
              {archived ? "戻す" : "消化"}
            </button>
          )}
          <button onClick={onDelete} className="text-rose-400/80 hover:text-rose-300">
            削除
          </button>
        </div>
      </div>
      {promoteOpen && (
        <div className="mt-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-2.5">
          <p className="mb-1.5 text-[11px] text-sky-700 dark:text-sky-300">
            タスクの締切
          </p>
          <div className="flex gap-1.5">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={pending}
              className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-500"
            />
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              disabled={pending}
              className="w-24 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              onClick={() => void promote()}
              disabled={pending}
              className="flex-1 rounded-md bg-sky-500 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {pending ? "作成中..." : "タスク化(メモは自動アーカイブ)"}
            </button>
            <button
              onClick={() => setPromoteOpen(false)}
              disabled={pending}
              className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 disabled:opacity-50"
            >
              やめる
            </button>
          </div>
          {error && <p className="mt-1 text-[11px] text-rose-500">{error}</p>}
        </div>
      )}
    </li>
  );
}
