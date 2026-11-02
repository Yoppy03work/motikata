"use client";

// 出席モードの設定。manual / confirm / auto の 3 択。
// auto は「開発者コード」(env ATTENDANCE_AUTO_DEV_CODE) を入力したときだけ解禁できる。
// コード未設定 (autoConfigured=false) のときは auto は選べない。
// CIT 認証情報は CitPortalSettings で登録済みのものを流用する。

import { useEffect, useState } from "react";
import { fetchJsonOrNull } from "@/lib/fetchJson";

type Mode = "manual" | "confirm" | "auto";

type SettingsResponse = {
  mode: Mode;
  autoUnlocked: boolean;
  autoConfigured: boolean;
};

const OPTIONS: { value: Mode; label: string; desc: string }[] = [
  {
    value: "confirm",
    label: "確認して送信",
    desc: "「今日」画面の「出席する」で出席 QR を読み取ると、モチカタが出席システムへ送信します。",
  },
  {
    value: "manual",
    label: "手動",
    desc: "自分で出席を取り、モチカタにはローカル記録だけ残します (送信しません)。",
  },
  {
    value: "auto",
    label: "自動 (開発者向け)",
    desc: "出席ウィンドウで自動送信します。有効化には開発者コードが必要です。",
  },
];

export function AttendanceSettings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // auto を選ぶとコード入力欄を開く
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    let ignore = false;
    void fetchJsonOrNull<SettingsResponse>("/api/attendance/settings").then((body) => {
      if (!ignore && body) setData(body);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const put = async (body: { mode: Mode; devCode?: string }) => {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/attendance/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: json.message ?? json.error ?? `保存失敗 (${res.status})`, error: true });
        return false;
      }
      setData((d) =>
        d ? { ...d, mode: body.mode, autoUnlocked: body.mode === "auto" } : d,
      );
      setMessage({ text: "保存しました", error: false });
      return true;
    } finally {
      setPending(false);
    }
  };

  const onSelect = (next: Mode) => {
    if (next === "auto") {
      // 既に解禁済みなら何もしない。未解禁ならコード入力欄を開く。
      setCode("");
      setCodeOpen(true);
      setMessage(null);
      return;
    }
    setCodeOpen(false);
    void put({ mode: next });
  };

  const submitCode = async () => {
    const ok = await put({ mode: "auto", devCode: code });
    if (ok) {
      setCodeOpen(false);
      setCode("");
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 text-xs">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">出席</p>
      <p className="mt-0.5 text-slate-500">
        出席の取り方を選びます。送信には「設定 › CIT ポータル」で登録した学籍番号・パスワードを使います。
      </p>

      {data === null ? (
        <p className="mt-2 text-slate-500">読み込み中…</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {OPTIONS.map((o) => {
            const active = data.mode === o.value;
            const autoLocked = o.value === "auto" && !data.autoConfigured;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  disabled={pending || autoLocked}
                  onClick={() => onSelect(o.value)}
                  className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition disabled:opacity-50 ${
                    active
                      ? "border-sky-500 bg-sky-500/5"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      active ? "border-sky-500" : "border-slate-400 dark:border-slate-600"
                    }`}
                  >
                    {active && <span className="h-2 w-2 rounded-full bg-sky-500" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {o.label}
                      {o.value === "auto" && active && data.autoUnlocked ? " ・解禁済み" : ""}
                      {autoLocked ? " ・コード未設定" : ""}
                    </span>
                    <span className="mt-0.5 block text-slate-500">{o.desc}</span>
                  </span>
                </button>

                {o.value === "auto" && codeOpen && data.autoConfigured && (
                  <div className="mt-1.5 flex items-center gap-1.5 pl-6">
                    <input
                      type="password"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="開発者コード"
                      autoComplete="off"
                      disabled={pending}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-hidden focus:ring-2 focus:ring-sky-500"
                    />
                    <button
                      type="button"
                      onClick={() => void submitCode()}
                      disabled={pending || code.length === 0}
                      className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      有効にする
                    </button>
                    <button
                      type="button"
                      onClick={() => setCodeOpen(false)}
                      disabled={pending}
                      className="rounded-md px-2 py-1.5 text-slate-500"
                    >
                      取消
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {message && (
        <p className={`mt-2 ${message.error ? "text-rose-500" : "text-sky-500"}`}>{message.text}</p>
      )}
    </div>
  );
}
