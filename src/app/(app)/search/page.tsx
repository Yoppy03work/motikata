"use client";

// タスク + メモを横断検索する画面。
// /api/search?q=... を叩いて、結果を 2 セクションに分けて表示。

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TZ } from "@/lib/tz";

type TaskHit = {
  id: number;
  title: string;
  dueAt: string;
  itemType: "TASK" | "EVENT";
  status: "OPEN" | "DONE" | "SKIPPED";
  required: boolean;
  priority: "LOW" | "MID" | "HIGH";
  notes: string | null;
  source: string;
};

type NoteHit = {
  id: number;
  body: string;
  kind: "INBOX" | "DIARY";
  archivedAt: string | null;
  promotedTaskId: number | null;
  createdAt: string;
};

function jstYmd(iso: string): string {
  return formatInTimeZone(new Date(iso), APP_TZ, "yyyy-MM-dd");
}

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(false);
  const [tasks, setTasks] = useState<TaskHit[]>([]);
  const [notes, setNotes] = useState<NoteHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (!q.trim()) {
      setTasks([]);
      setNotes([]);
      setHasSearched(false);
      return;
    }
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      setPending(true);
      setError(null);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof body.error === "string" ? body.error : `失敗 (${res.status})`);
          return;
        }
        setTasks(body.tasks ?? []);
        setNotes(body.notes ?? []);
        setHasSearched(true);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "検索失敗");
      } finally {
        setPending(false);
      }
    }, 300);
    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [q]);

  return (
    <main className="px-4 pt-6 pb-8">
      <header className="mb-3">
        <h1 className="text-2xl font-semibold">検索</h1>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
          タスク・メモを横断検索(タイトル / 内容 / 備考)
        </p>
      </header>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="キーワード(例: レポート、数学、教科書)"
        autoFocus
        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
      />

      {pending && <p className="mt-3 text-xs text-slate-500">検索中…</p>}
      {error && <p className="mt-3 text-xs text-rose-500">{error}</p>}

      {hasSearched && !pending && (
        <div className="mt-4 space-y-4">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              タスク・予定 <span className="text-slate-500">({tasks.length})</span>
            </h2>
            {tasks.length === 0 ? (
              <p className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-3 text-xs text-slate-500">
                該当なし
              </p>
            ) : (
              <ul className="space-y-1.5">
                {tasks.map((t) => (
                  <li
                    key={t.id}
                    className={`rounded-md border border-slate-200 dark:border-slate-800 p-2.5 ${
                      t.status === "DONE"
                        ? "bg-slate-100/50 dark:bg-slate-900/40 opacity-60"
                        : "bg-white dark:bg-slate-950"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="tabular-nums">
                        {formatInTimeZone(new Date(t.dueAt), APP_TZ, "M/d HH:mm")}
                      </span>
                      <span className="rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5">
                        {t.itemType === "EVENT" ? "予定" : t.required ? "必須" : "任意"}
                      </span>
                      {t.status !== "OPEN" && (
                        <span className="rounded bg-slate-300 dark:bg-slate-700 px-1.5 py-0.5">
                          {t.status === "DONE" ? "完了" : "スキップ"}
                        </span>
                      )}
                      <Link
                        href={`/today?date=${jstYmd(t.dueAt)}`}
                        className="ml-auto text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        その日を開く →
                      </Link>
                    </div>
                    <p
                      className={`mt-1 text-sm font-medium ${t.status === "DONE" ? "line-through" : ""}`}
                    >
                      {t.title}
                    </p>
                    {t.notes && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600 dark:text-slate-400">
                        {t.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              メモ <span className="text-slate-500">({notes.length})</span>
            </h2>
            {notes.length === 0 ? (
              <p className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-3 text-xs text-slate-500">
                該当なし
              </p>
            ) : (
              <ul className="space-y-1.5">
                {notes.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="tabular-nums">
                        {formatInTimeZone(new Date(n.createdAt), APP_TZ, "M/d HH:mm")}
                      </span>
                      <span className="rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5">
                        {n.kind === "INBOX" ? "Inbox" : "日次"}
                      </span>
                      {n.promotedTaskId && (
                        <span className="rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 px-1.5 py-0.5">
                          ✓ タスク化済
                        </span>
                      )}
                      {n.archivedAt && (
                        <span className="rounded bg-slate-300 dark:bg-slate-700 px-1.5 py-0.5 opacity-60">
                          消化
                        </span>
                      )}
                      <Link
                        href="/memo"
                        className="ml-auto text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        メモを開く →
                      </Link>
                    </div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm">
                      {n.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
