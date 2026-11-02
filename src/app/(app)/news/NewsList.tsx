"use client";

// コースニュースの一覧。押すと manaba の本文を別タブで開き、アプリ上は既読にする。
// 締切や持ち物が書いてあるニュースは「タスクにする」で締切を決めてタスク化できる。

import { useState } from "react";
import Link from "next/link";

export type NewsRow = {
  id: number;
  courseName: string;
  title: string;
  author: string | null;
  publishedAt: string;
  url: string;
  read: boolean;
  hasTask: boolean;
};

const fmt = (ts: string) =>
  new Date(ts).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// 既定の締切: 明日の 23:59(JST)。datetime-local は JST の壁時計で扱う
function defaultDue(): string {
  const jst = new Date(Date.now() + 9 * 3600_000 + 24 * 3600_000);
  return `${jst.toISOString().slice(0, 10)}T23:59`;
}

export function NewsList({ initial }: { initial: NewsRow[] }) {
  const [items, setItems] = useState(initial);
  const [showRead, setShowRead] = useState(false);
  const [taskFor, setTaskFor] = useState<number | null>(null);
  const [due, setDue] = useState(defaultDue);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  const unread = items.filter((n) => !n.read);
  const visible = showRead ? items : unread;

  const markRead = async (ids: number[] | "all", read = true) => {
    setItems((prev) => prev.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, read } : n)));
    await fetch("/api/manaba/news", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, read }),
    }).catch(() => undefined);
  };

  const createTask = async (id: number) => {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/manaba/news/${id}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: new Date(`${due}:00+09:00`).toISOString() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: body.error ?? `作成に失敗しました (${res.status})`, error: true });
        return;
      }
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, hasTask: true, read: true } : n)));
      setTaskFor(null);
      setMessage({ text: body.created ? "タスクにしました" : "このニュースのタスクはすでにあります", error: false });
    } finally {
      setPending(false);
    }
  };

  const btn =
    "rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300 disabled:opacity-50";

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">manaba のお知らせ</h1>
        {unread.length > 0 && (
          <button type="button" onClick={() => void markRead("all")} className={btn}>
            すべて既読
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
        <span>未読 {unread.length} 件</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showRead} onChange={(e) => setShowRead(e.target.checked)} />
          既読も表示
        </label>
      </div>
      <p className="text-xs text-slate-500">
        manaba の同期(1 日 3 回)のたびに取り込みます。本文は manaba で開いてください(開くと manaba 側も既読になります)。
      </p>
      {message && <p className={`text-xs ${message.error ? "text-rose-500" : "text-sky-500"}`}>{message.text}</p>}

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500">
          {items.length === 0 ? "まだコースニュースはありません" : "未読のお知らせはありません"}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((n) => (
            <li
              key={n.id}
              className={`rounded-lg border p-3 ${
                n.read
                  ? "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                  : "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40"
              }`}
            >
              <p className="text-[11px] text-slate-500">
                {n.courseName}・{fmt(n.publishedAt)}
                {n.author && `・${n.author}`}
              </p>
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => !n.read && void markRead([n.id])}
                className="mt-0.5 block text-sm font-medium text-slate-900 underline-offset-2 hover:underline dark:text-slate-100"
              >
                {!n.read && <span className="mr-1 text-sky-500">●</span>}
                {n.title}
              </a>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {n.hasTask ? (
                  <Link href="/tasks" className={btn}>
                    タスクあり
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setTaskFor(taskFor === n.id ? null : n.id);
                      setDue(defaultDue());
                    }}
                    className={btn}
                  >
                    タスクにする
                  </button>
                )}
                <button type="button" onClick={() => void markRead([n.id], !n.read)} className={btn}>
                  {n.read ? "未読に戻す" : "既読にする"}
                </button>
              </div>
              {taskFor === n.id && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-slate-600 dark:text-slate-400">締切</span>
                  <input
                    type="datetime-local"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    disabled={pending}
                    aria-label="タスクの締切"
                    className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => void createTask(n.id)}
                    disabled={pending || !due}
                    className="rounded-md bg-sky-500 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {pending ? "作成中..." : "作成"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
