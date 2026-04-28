"use client";

// manaba 連携の認証情報管理 + 同期 UI。
// セキュリティ:
//   - パスワードは送信時のみ平文、サーバ側で暗号化保存
//   - 取得時はマスク表示(GET ではパスワード返さない)
//   - ローカルストレージには保存しない

import { useCallback, useEffect, useState } from "react";

type CredentialState = {
  id: number;
  username: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  updatedAt: string;
} | null;

export function ManabaSettings() {
  const [cred, setCred] = useState<CredentialState>(null);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/manaba/credentials");
    if (res.ok) {
      const body = await res.json();
      setCred(body.credential);
      if (!body.credential) setEditing(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    if (!username || !password) {
      setError("MARINE IDとパスワードを両方入力してください");
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manaba/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `保存失敗 (${res.status})`);
        return;
      }
      setMessage("保存しました");
      setPassword("");
      setEditing(false);
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!confirm("manaba 認証情報を削除します。よろしいですか?")) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/manaba/credentials", { method: "DELETE" });
      if (!res.ok) {
        setError(`削除失敗 (${res.status})`);
        return;
      }
      setUsername("");
      setPassword("");
      setEditing(false);
      setMessage("削除しました");
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const sync = async () => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manaba/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `同期失敗 (${res.status})`);
        return;
      }
      setMessage(
        `同期完了: 取得 ${body.fetched ?? 0} / 取込対象 ${body.target ?? 0} / 追加 ${body.inserted ?? 0} / 更新 ${body.updated ?? 0}` +
          ((body.pastSkipped ?? 0) > 0
            ? ` / 過去 ${body.pastSkipped} 件は除外`
            : ""),
      );
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const formatTs = (ts: string | null) =>
    ts
      ? new Date(ts).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        manaba にログインして課題一覧を取得し、タスクとして自動登録します。
        パスワードは AES-256-GCM で暗号化して保存します。
      </p>

      {cred && !editing && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 text-xs">
          <div className="text-slate-700 dark:text-slate-300">
            <span className="font-medium">MARINE ID:</span> {cred.username}
          </div>
          <div className="mt-0.5 text-slate-500">
            最終同期: {formatTs(cred.lastSyncedAt)}
          </div>
          {cred.lastError && (
            <p className="mt-1 text-rose-500 text-[11px]">
              直近エラー: {cred.lastError}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void sync()}
              disabled={pending}
              className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {pending ? "同期中..." : "今すぐ同期"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setUsername(cred.username);
                setPassword("");
              }}
              disabled={pending}
              className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 disabled:opacity-50"
            >
              認証情報を更新
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
        </div>
      )}

      {editing && (
        <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
          <label className="block text-xs">
            <span className="block text-slate-600 dark:text-slate-400">
              MARINE ID
            </span>
            <input
              type="text"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={pending}
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
            />
          </label>
          <label className="block text-xs">
            <span className="block text-slate-600 dark:text-slate-400">
              パスワード
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={pending}
              className="flex-1 rounded-md bg-sky-500 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "保存中..." : "保存"}
            </button>
            {cred && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setPassword("");
                }}
                disabled={pending}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50"
              >
                やめる
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-rose-500">{error}</p>}
      {message && <p className="text-xs text-emerald-500">{message}</p>}
    </div>
  );
}
