"use client";

// CITポータル(Universal Passport RX)連携の認証情報管理 + 同期 UI。
// セキュリティ:
//   - パスワード/TOTPシークレットは送信時のみ平文、サーバ側で暗号化保存
//   - 取得時はマスク表示(GET ではどちらも返さない)
//   - ローカルストレージには保存しない

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";

// QR スキャナはカメラ APIを使うので SSR 無効でクライアントのみロード。
const TotpQrScanner = dynamic(
  () => import("./TotpQrScanner").then((m) => m.TotpQrScanner),
  { ssr: false },
);

type CredentialState = {
  id: number;
  username: string;
  totpDeviceName: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  updatedAt: string;
} | null;

export function CitPortalSettings() {
  const [cred, setCred] = useState<CredentialState>(null);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpDeviceName, setTotpDeviceName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/cit-portal/credentials");
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
    if (!username || !password || !totpSecret) {
      setError("ユーザーID・パスワード・TOTPシークレットをすべて入力してください");
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/cit-portal/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          totpSecret,
          totpDeviceName: totpDeviceName.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `保存失敗 (${res.status})`);
        return;
      }
      setMessage("保存しました");
      setPassword("");
      setTotpSecret("");
      setTotpDeviceName("");
      setEditing(false);
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!confirm("CITポータル認証情報を削除します。よろしいですか?")) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/cit-portal/credentials", {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(`削除失敗 (${res.status})`);
        return;
      }
      setUsername("");
      setPassword("");
      setTotpSecret("");
      setTotpDeviceName("");
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
      const res = await fetch("/api/cit-portal/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `同期失敗 (${res.status})`);
        return;
      }
      setMessage(
        `同期完了: 取得 ${body.fetched ?? 0} / 置換 ${body.replaced ?? 0}`,
      );
      await refresh();
    } finally {
      setPending(false);
    }
  };

  // 保存済みシークレットから現在のTOTPコードを生成して目視確認用に表示。
  // Authenticatorアプリの表示と一致しなければ シークレットが間違ってる。
  const testOtp = async () => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/cit-portal/test-otp", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          body.genError
            ? `TOTP生成失敗: ${body.genError}\nシークレット: ${body.secretMasked ?? "?"}\nBASE32妥当性: ${body.validBase32 ? "OK" : "NG"}`
            : (body.error ?? `OTPテスト失敗 (${res.status})`),
        );
        return;
      }
      setMessage(
        `現在のOTP: ${body.code} (残り${body.remainingSec}秒)\n` +
          `30秒前: ${body.codePrev} / 30秒後: ${body.codeNext}\n` +
          `シークレット: ${body.secretMasked} / BASE32: ${body.validBase32 ? "有効" : "無効"}\n` +
          `サーバ時刻: ${body.serverTime}\n` +
          `Authenticatorアプリの6桁と一致するか確認してください`,
      );
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
        CITポータル(Universal Passport)から時間割を取得して
        <code>ClassSchedule</code>を自動更新します。
        SSOのMFAは Authenticatorアプリで登録したTOTPシークレットを使い、
        サーバー側で6桁コードを生成してログインします。
      </p>
      <p className="text-[11px] text-rose-500">
        ※ TOTPシークレットを保存するため、DB と SESSION_SECRET が同時に漏洩した場合
        MFA 保護は失われます。リスクを理解した上で利用してください。
      </p>

      {cred && !editing && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 text-xs">
          <div className="text-slate-700 dark:text-slate-300">
            <span className="font-medium">ユーザーID:</span> {cred.username}
          </div>
          {cred.totpDeviceName && (
            <div className="mt-0.5 text-slate-500">
              <span className="font-medium">デバイス名:</span> {cred.totpDeviceName}
            </div>
          )}
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
              onClick={() => void testOtp()}
              disabled={pending}
              className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 disabled:opacity-50"
            >
              OTP生成テスト
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setUsername(cred.username);
                setPassword("");
                setTotpSecret("");
                setTotpDeviceName(cred.totpDeviceName ?? "");
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
              ユーザーID(MARINE ID/学籍番号)
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
          <label className="block text-xs">
            <span className="block text-slate-600 dark:text-slate-400">
              TOTPシークレット
            </span>
            <div className="mt-1 flex gap-1.5">
              <input
                type="password"
                autoComplete="off"
                value={totpSecret}
                onChange={(e) => setTotpSecret(e.target.value)}
                disabled={pending}
                placeholder="BASE32 または otpauth:// URI"
                className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                disabled={pending}
                className="shrink-0 rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 text-xs font-medium text-sky-700 dark:text-sky-300 disabled:opacity-50"
              >
                QRスキャン
              </button>
            </div>
            <span className="mt-1 block text-[11px] text-slate-500">
              ポータルのMFA登録画面のQRコードを直接読み込めます。
              手入力する場合はQR下のシークレット文字列、または
              <code className="mx-0.5">otpauth://</code> URI 全体を貼り付け。
            </span>
          </label>
          <label className="block text-xs">
            <span className="block text-slate-600 dark:text-slate-400">
              デバイス名 (任意)
            </span>
            <input
              type="text"
              autoComplete="off"
              value={totpDeviceName}
              onChange={(e) => setTotpDeviceName(e.target.value)}
              disabled={pending}
              placeholder="例: PC(motica)"
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              ポータルでTOTP登録時に付けた名前。
              ログイン時のクレデンシャル選択画面で「この名前を含む項目」が選ばれる(部分一致)。
              MFA手段が1つだけなら空欄でOK。
            </span>
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
                  setTotpSecret("");
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

      {error && <p className="whitespace-pre-line text-xs text-rose-500">{error}</p>}
      {message && (
        <p className="whitespace-pre-line text-xs text-sky-500">{message}</p>
      )}

      {showScanner && (
        <TotpQrScanner
          onResult={(text) => {
            // QR の内容(otpauth:// URI もしくは BASE32 文字列)を
            // そのままシークレット欄に詰めて、サーバ側 normalize に任せる。
            setTotpSecret(text);
            setShowScanner(false);
            setError(null);
            setMessage("QRを読み取りました。続けて「保存」を押してください。");
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
