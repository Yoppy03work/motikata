"use client";

// Web Push 通知の購読切替 UI。
// 流れ:
//   1. Service Worker (/sw.js) を register
//   2. Notification.permission を取得
//   3. 公開 VAPID 鍵を /api/push/vapid-public-key から取得
//   4. PushManager.subscribe() で購読 → /api/push/subscribe に保存

import { useCallback, useEffect, useState } from "react";

type PushState = "loading" | "unsupported" | "off" | "denied" | "on";

// PushManager.subscribe() の applicationServerKey は ArrayBuffer 等を要求する。
// 新しい TS の型では Uint8Array<ArrayBufferLike> がそのままでは入らないので、
// .buffer (ArrayBuffer) で渡す。
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const std = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(std);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export function PushSettings() {
  const [state, setState] = useState<PushState>("loading");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      if (!reg) {
        setState("off");
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    } catch {
      setState("off");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        if ("serviceWorker" in navigator) {
          await navigator.serviceWorker.register("/sw.js");
        }
      } catch {
        /* noop */
      }
      await refresh();
    })();
  }, [refresh]);

  const enable = async () => {
    setError(null);
    setPending(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push/vapid-public-key");
      if (!keyRes.ok) {
        setError("VAPID 鍵の取得に失敗しました(.env を確認)");
        return;
      }
      const { publicKey } = await keyRes.json();
      if (!publicKey) {
        setError("VAPID_PUBLIC_KEY が空です");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      });
      const json = sub.toJSON();
      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        }),
      });
      if (!saveRes.ok) {
        setError(`サーバ保存失敗 (${saveRes.status})`);
        return;
      }
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "通知の有効化に失敗しました");
    } finally {
      setPending(false);
    }
  };

  const disable = async () => {
    setError(null);
    setPending(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "解除に失敗しました");
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        スマホ・PC のロック画面に通知が出ます。タスク作成時に
        「通知 = アプリ通知」を選んだリマインダーで使用されます。
      </p>

      {state === "loading" && (
        <p className="text-xs text-slate-500">確認中…</p>
      )}
      {state === "unsupported" && (
        <p className="text-xs text-slate-500">
          このブラウザは Web Push 通知に未対応です(iOS は Safari 16.4+ かつ
          ホーム画面に追加した PWA で利用可能)
        </p>
      )}
      {state === "denied" && (
        <p className="text-xs text-rose-500">
          通知が拒否されています。ブラウザ設定で許可に変更してください。
        </p>
      )}
      {state === "off" && (
        <button
          type="button"
          onClick={() => void enable()}
          disabled={pending}
          className="w-full rounded-md bg-sky-500 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-sky-600"
        >
          {pending ? "設定中..." : "通知を有効にする"}
        </button>
      )}
      {state === "on" && (
        <div className="flex items-center gap-2">
          <span className="flex-1 rounded-md bg-sky-500/10 border border-sky-500/30 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
            通知は有効です
          </span>
          <button
            type="button"
            onClick={() => void disable()}
            disabled={pending}
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 disabled:opacity-50"
          >
            無効化
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
    </div>
  );
}
