"use client";

// アプリが止まったことに気づくための設定。
//   - 最後に止まっていた期間を表示する(止まっている間の通知は復帰時に 1 通にまとめて届く)
//   - 外部の見張り(healthchecks.io)の Ping URL を登録する。アプリが止まると
//     アプリからは通知できないので、ping が途絶えたら healthchecks.io 側から知らせてもらう

import { useCallback, useEffect, useState } from "react";
import { fetchJsonOrNull } from "@/lib/fetchJson";

type Status = {
  configured: boolean;
  summary: string | null;
  lastPingAt: string | null;
  lastError: string | null;
  lastOutage: { from: string; to: string } | null;
};

const fmt = (ts: string) =>
  new Date(ts).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function WatchdogSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const body = await fetchJsonOrNull<Status>("/api/notify/watchdog");
    if (body) setStatus(body);
  }, []);

  useEffect(() => {
    let ignore = false;
    void fetchJsonOrNull<Status>("/api/notify/watchdog").then((body) => {
      if (!ignore && body) setStatus(body);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const request = async (init: RequestInit, okText: string) => {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/notify/watchdog", init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: body.error ?? `失敗しました (${res.status})`, error: true });
        return false;
      }
      if (body.ping && !body.ping.ok) {
        setMessage({ text: `保存しましたが、ping に失敗しました: ${body.ping.error}`, error: true });
        return true;
      }
      setMessage({ text: okText, error: false });
      return true;
    } finally {
      setPending(false);
      await refresh();
    }
  };

  const save = async () => {
    const ok = await request(
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) },
      "保存して ping しました。healthchecks.io で「up」になっているか確認してください",
    );
    if (ok) {
      setEditing(false);
      setUrl("");
    }
  };

  const remove = async () => {
    if (!confirm("外部の見張りの登録を削除します。よろしいですか?")) return;
    await request({ method: "DELETE" }, "削除しました");
  };

  const btn =
    "rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 disabled:opacity-50";

  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 text-xs">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">止まったときの通知</p>
      <p className="mt-0.5 text-slate-500">
        Mac のスリープや Docker の停止でアプリが止まっている間の通知は、復帰したときに止まっていた時間と一緒に
        1 通にまとめて届きます。締切を過ぎてしまった manaba の課題があれば、それも知らせます。
      </p>
      {status?.lastOutage && (
        <p className="mt-1 text-slate-700 dark:text-slate-300">
          最後に止まっていた時間: {fmt(status.lastOutage.from)}〜{fmt(status.lastOutage.to)}
        </p>
      )}

      <p className="mt-3 font-medium text-slate-700 dark:text-slate-300">外部の見張り(任意)</p>
      <p className="mt-0.5 text-slate-500">
        止まっている最中はアプリから知らせられません。healthchecks.io(無料)に登録すると、アプリからの連絡が途絶えたときに
        healthchecks.io からメール・Discord・LINE などで知らせてもらえます。
      </p>

      {status?.configured && !editing && (
        <>
          <p className="mt-2 text-slate-500">
            Ping URL: {status.summary}
            {status.lastPingAt && ` / 最終 ping: ${fmt(status.lastPingAt)}`}
          </p>
          {status.lastError && <p className="mt-1 text-[11px] text-rose-500">直近エラー: {status.lastError}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => void request({ method: "POST" }, "ping しました")} disabled={pending} className={btn}>
              {pending ? "送信中..." : "テスト ping"}
            </button>
            <button type="button" onClick={() => setEditing(true)} disabled={pending} className={btn}>
              変更
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={pending}
              className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-xs text-rose-600 dark:text-rose-300 disabled:opacity-50"
            >
              削除
            </button>
          </div>
        </>
      )}

      {status && !status.configured && !editing && (
        <button type="button" onClick={() => setEditing(true)} className={`mt-2 ${btn}`}>
          登録する
        </button>
      )}

      {editing && (
        <div className="mt-2 space-y-2">
          <ol className="list-decimal space-y-0.5 pl-4 text-slate-500">
            <li>healthchecks.io にサインアップし、「Add Check」で見張りを作ります。</li>
            <li>
              Period は 5 分、Grace Time は好みで設定します(Mac を閉じている間も知らせが来るので、夜に閉じるなら長めに)。
            </li>
            <li>Integrations で知らせてほしい先(メール・Discord など)を選びます。</li>
            <li>表示された Ping URL(https://hc-ping.com/…)を下に貼り付けます。</li>
          </ol>
          <input
            type="password"
            autoComplete="off"
            value={url}
            placeholder="https://hc-ping.com/…"
            onChange={(e) => setUrl(e.target.value)}
            disabled={pending}
            aria-label="healthchecks.io の Ping URL"
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-hidden focus:ring-2 focus:ring-sky-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={pending || !url.trim()}
              className="flex-1 rounded-md bg-sky-500 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "保存中..." : "保存"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={pending} className={btn}>
              やめる
            </button>
          </div>
        </div>
      )}
      {message && <p className={`mt-2 ${message.error ? "text-rose-500" : "text-sky-500"}`}>{message.text}</p>}
    </div>
  );
}
