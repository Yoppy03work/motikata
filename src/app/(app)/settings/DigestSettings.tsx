"use client";

// 締切のまとめ通知の時刻(アラーム)。
// 「今日 1 件・明日 2 件・7 日以内 3 件」を設定した時刻に 1 通で届ける。時刻は追加・削除でき、すぐ保存される。

import { useEffect, useState } from "react";
import { fetchJsonOrNull } from "@/lib/fetchJson";

const MAX_TIMES = 6;

export function DigestSettings() {
  const [times, setTimes] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("07:00");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let ignore = false;
    void fetchJsonOrNull<{ times: string[] }>("/api/notify/digest").then((body) => {
      if (!ignore && body) setTimes(body.times);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const save = async (next: string[]) => {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/notify/digest", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ times: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: body.error ?? `保存失敗 (${res.status})`, error: true });
        return;
      }
      setTimes(body.times);
    } finally {
      setPending(false);
    }
  };

  const add = () => {
    if (!times) return;
    if (!/^\d{2}:\d{2}$/.test(draft)) {
      setMessage({ text: "時刻を選んでください", error: true });
      return;
    }
    if (times.includes(draft)) {
      setMessage({ text: "同じ時刻がすでにあります", error: true });
      return;
    }
    void save([...times, draft]);
  };

  const sendNow = async () => {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/notify/digest", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setMessage(
        res.ok
          ? { text: "送りました。通知先に届いているか確認してください", error: false }
          : { text: body.error ?? `送信失敗 (${res.status})`, error: true },
      );
    } finally {
      setPending(false);
    }
  };

  const full = (times?.length ?? 0) >= MAX_TIMES;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">締切のまとめ通知</p>
        <button
          type="button"
          onClick={() => void sendNow()}
          disabled={pending}
          className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 disabled:opacity-50"
        >
          今すぐ送ってみる
        </button>
      </div>
      <p className="mt-0.5 text-slate-500">
        設定した時刻に、締切が近い未完了のタスクを「今日・明日・7 日以内」に分けて 1 通で知らせます。該当がない日は送りません。
      </p>

      {times === null ? (
        <p className="mt-2 text-slate-500">読み込み中…</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {times.length === 0 && <li className="text-amber-600 dark:text-amber-400">送りません</li>}
          {times.map((t) => (
            <li
              key={t}
              className="flex items-center justify-between rounded-md border border-slate-200 dark:border-slate-800 px-3 py-2"
            >
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">毎日 {t}</span>
              <button
                type="button"
                onClick={() => void save(times.filter((x) => x !== t))}
                disabled={pending}
                aria-label={`毎日 ${t} を削除`}
                className="rounded-md px-2 py-1 text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

      {times !== null && !full && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-slate-600 dark:text-slate-400">毎日</span>
          <input
            type="time"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pending}
            aria-label="まとめ通知の時刻"
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-hidden focus:ring-2 focus:ring-sky-500"
          />
          <button
            type="button"
            onClick={add}
            disabled={pending}
            className="ml-auto rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            ＋ 追加
          </button>
        </div>
      )}
      {full && <p className="mt-2 text-slate-500">最大 {MAX_TIMES} 個までです</p>}
      {message && <p className={`mt-2 ${message.error ? "text-rose-500" : "text-sky-500"}`}>{message.text}</p>}
    </div>
  );
}
