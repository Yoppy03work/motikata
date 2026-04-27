"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale/ja";

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
    const d = new Date();
    return format(d, "yyyy-MM-dd");
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
}: {
  note: Note;
  tab: Tab;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const archived = !!note.archivedAt;
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
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {format(new Date(note.createdAt), "M/d HH:mm", { locale: ja })}
          {tab === "stream" && (
            <span className="ml-2 rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5">
              {note.kind === "INBOX" ? "Inbox" : "日次"}
            </span>
          )}
        </span>
        <div className="flex gap-2">
          {note.kind === "INBOX" && (
            <button onClick={onArchive} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
              {archived ? "戻す" : "消化"}
            </button>
          )}
          <button onClick={onDelete} className="text-rose-400/80 hover:text-rose-300">
            削除
          </button>
        </div>
      </div>
    </li>
  );
}
