"use client";

// Google カレンダー連携 (Phase 1) UI。
// - 未連携: 「Google で連携」ボタン (→ /api/oauth/google/authorize に遷移)
// - 連携済み: email・最終同期時刻・直近エラー表示 + 「今すぐ同期」「解除」ボタン

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Status = {
  connected: boolean;
  email?: string;
  lastSyncAt?: string;
  lastError?: string | null;
};

type CalendarRow = {
  id: number;
  summary: string;
  isPrimary: boolean;
  colorHex: string | null;
  enabled: boolean;
  accessRole: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
};

async function fetchStatus(): Promise<Status> {
  const res = await fetch("/api/oauth/google/status", { cache: "no-store" });
  if (!res.ok) return { connected: false };
  return (await res.json()) as Status;
}

async function fetchCalendars(): Promise<CalendarRow[]> {
  const res = await fetch("/api/google/calendars", { cache: "no-store" });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => ({}))) as { calendars?: CalendarRow[] };
  return body.calendars ?? [];
}

export function GoogleCalendarSettings() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [calendars, setCalendars] = useState<CalendarRow[] | null>(null);
  const [busy, startBusy] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [s, cs] = await Promise.all([fetchStatus(), fetchCalendars()]);
    setStatus(s);
    setCalendars(cs);
  };

  // /api/oauth/google/callback から ?google=ok&msg=... or ?google=error&msg=... で
  // 戻ってくる。1 度表示したら URL から消す。
  useEffect(() => {
    const flag = params.get("google");
    const msg = params.get("msg");
    if (flag === "ok" && msg) setMessage(msg);
    else if (flag === "error" && msg) setError(msg);
    if (flag) {
      const url = new URL(window.location.href);
      url.searchParams.delete("google");
      url.searchParams.delete("msg");
      window.history.replaceState({}, "", url.toString());
    }
  }, [params]);

  useEffect(() => {
    void refresh();
  }, []);

  const handleConnect = () => {
    // /api/oauth/google/authorize は 302 で Google に飛ばす。
    // <a href> ではなく明示的に window.location でフロー開始(Cookie set のため
    // ブラウザに必ず保存させる)。
    window.location.href = "/api/oauth/google/authorize";
  };

  const handleSyncNow = () => {
    setMessage(null);
    setError(null);
    startBusy(async () => {
      const res = await fetch("/api/oauth/google/sync-now", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        added?: number;
        updated?: number;
        cancelled?: number;
        skipped?: number;
        skippedTombstone?: number;
      };
      if (res.ok && body.ok) {
        const tombstoneSuffix =
          body.skippedTombstone && body.skippedTombstone > 0
            ? ` / 削除済 ${body.skippedTombstone}`
            : "";
        setMessage(
          `同期完了: 追加 ${body.added ?? 0} / 更新 ${body.updated ?? 0} / 取消 ${body.cancelled ?? 0} / スキップ ${body.skipped ?? 0}${tombstoneSuffix}`,
        );
        await refresh();
        router.refresh();
      } else {
        setError(`同期失敗: ${body.error ?? res.status}`);
        await refresh();
      }
    });
  };

  const handleDisconnect = () => {
    if (!confirm("Google カレンダー連携を解除します。よろしいですか？")) return;
    setMessage(null);
    setError(null);
    startBusy(async () => {
      const res = await fetch("/api/oauth/google/disconnect", { method: "POST" });
      if (res.ok) {
        setMessage("連携を解除しました");
        setStatus({ connected: false });
        setCalendars([]);
        router.refresh();
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(`解除失敗: ${body.error ?? res.status}`);
      }
    });
  };

  const handleToggle = (id: number, enabled: boolean) => {
    setMessage(null);
    setError(null);
    startBusy(async () => {
      const res = await fetch(`/api/google/calendars/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        // 楽観的に local state を更新 + ステータス再読込で確定値に揃える。
        setCalendars((prev) =>
          prev ? prev.map((c) => (c.id === id ? { ...c, enabled } : c)) : prev,
        );
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(`切替失敗: ${body.error ?? res.status}`);
        await refresh();
      }
    });
  };

  if (!status) {
    return <p className="text-xs text-slate-500">読み込み中...</p>;
  }

  return (
    <div className="space-y-3">
      {message ? (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {status.connected ? (
        <>
          <div className="text-xs text-slate-700 dark:text-slate-300">
            <div>
              連携先: <span className="font-medium">{status.email}</span>
            </div>
            {status.lastSyncAt ? (
              <div>最終同期: {new Date(status.lastSyncAt).toLocaleString("ja-JP")}</div>
            ) : (
              <div>最終同期: まだ実行されていません</div>
            )}
            {status.lastError ? (
              <div className="mt-1 text-rose-600 dark:text-rose-400">
                直近エラー: {status.lastError}
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={busy}
              className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-700 dark:text-sky-300 active:scale-95 disabled:opacity-50"
            >
              {busy ? "同期中..." : "今すぐ同期"}
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-700 dark:text-rose-300 active:scale-95 disabled:opacity-50"
            >
              連携解除
            </button>
          </div>

          {calendars && calendars.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                取り込みカレンダー (チェックを外すと同期から除外)
              </div>
              <ul className="space-y-1">
                {calendars.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      disabled={busy}
                      onChange={(e) => handleToggle(c.id, e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-sm"
                      style={{ background: c.colorHex ?? "#94a3b8" }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate text-xs text-slate-800 dark:text-slate-200">
                      {c.summary}
                      {c.isPrimary ? (
                        <span className="ml-1 text-[10px] text-sky-600 dark:text-sky-400">
                          (主)
                        </span>
                      ) : null}
                      {/* Phase 14d: 読み取り専用バッジ */}
                      {c.accessRole === "reader" ||
                      c.accessRole === "freeBusyReader" ? (
                        <span className="ml-1 rounded-sm bg-slate-300 px-1 text-[10px] text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                          読み取り専用
                        </span>
                      ) : null}
                    </span>
                    {c.lastError ? (
                      <span
                        className="text-[10px] text-rose-600 dark:text-rose-400"
                        title={c.lastError}
                      >
                        エラー
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Google カレンダーの予定を /calendar と /today に表示します (Phase 1: 読み取り専用)。
            連携には Google Cloud Console での OAuth 設定が必要 ({" "}
            <code className="text-[10px]">docs/google-calendar.md</code> 参照)。
          </p>
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy}
            className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-700 dark:text-sky-300 active:scale-95 disabled:opacity-50"
          >
            Google で連携
          </button>
        </>
      )}
    </div>
  );
}
