"use client";

// 出席モードの設定。manual / confirm / auto の 3 択。
// auto はフェーズ A では「準備中」で選べない (実送信の env 解禁はフェーズ B)。
// CIT 認証情報は CitPortalSettings で登録済みのものを流用する。

import { useEffect, useState } from "react";
import { fetchJsonOrNull } from "@/lib/fetchJson";

type Mode = "manual" | "confirm" | "auto";

const OPTIONS: { value: Mode; label: string; desc: string; disabled?: boolean }[] = [
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
    label: "自動 (準備中)",
    desc: "出席ウィンドウで自動送信します。学内での段階検証が済むまで無効です。",
    disabled: true,
  },
];

export function AttendanceSettings() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let ignore = false;
    void fetchJsonOrNull<{ mode: Mode }>("/api/attendance/settings").then((body) => {
      if (!ignore && body) setMode(body.mode);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const save = async (next: Mode) => {
    setPending(true);
    setMessage(null);
    const prev = mode;
    setMode(next);
    try {
      const res = await fetch("/api/attendance/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMode(prev);
        setMessage({ text: body.error ?? `保存失敗 (${res.status})`, error: true });
        return;
      }
      setMessage({ text: "保存しました", error: false });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 text-xs">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">出席</p>
      <p className="mt-0.5 text-slate-500">
        出席の取り方を選びます。送信には「設定 › CIT ポータル」で登録した学籍番号・パスワードを使います。
      </p>

      {mode === null ? (
        <p className="mt-2 text-slate-500">読み込み中…</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {OPTIONS.map((o) => {
            const active = mode === o.value;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  disabled={pending || o.disabled}
                  onClick={() => void save(o.value)}
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
                    </span>
                    <span className="mt-0.5 block text-slate-500">{o.desc}</span>
                  </span>
                </button>
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
