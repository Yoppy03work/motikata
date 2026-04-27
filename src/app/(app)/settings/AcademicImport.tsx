"use client";

// 学年歴 ICS のアップロード UI(設定画面に組み込み)。
// 流れ: ファイル選択 → ローカルで text 化 → /api/academic/import に POST
// dryRun でプレビュー → 確認 → 本番 import の2段階。

import { useState } from "react";

type Preview = {
  title: string;
  date: string; // ISO
  kind: "EXAM" | "HOLIDAY" | "EVENT";
};

const KIND_LABEL: Record<Preview["kind"], string> = {
  EXAM: "試験",
  HOLIDAY: "休日",
  EVENT: "予定",
};

export function AcademicImport() {
  const [text, setText] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setText("");
    setFilename("");
    setPreview(null);
    setMessage(null);
    setError(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setMessage(null);
    setPreview(null);
    if (file.size > 2_000_000) {
      setError("ファイルが大きすぎます (2MB 以下)");
      return;
    }
    const t = await file.text();
    setText(t);
    setFilename(file.name);
    // 即プレビュー
    setPending(true);
    try {
      const res = await fetch("/api/academic/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, dryRun: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `プレビュー失敗 (${res.status})`);
        return;
      }
      setPreview(body.preview ?? []);
    } finally {
      setPending(false);
    }
  };

  const onImport = async () => {
    if (!text) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/academic/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: filename || "ics" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `インポート失敗 (${res.status})`);
        return;
      }
      setMessage(`インポート完了: 追加 ${body.inserted ?? 0} 件 / スキップ(重複)${body.skipped ?? 0} 件`);
      setPreview(null);
      setText("");
      setFilename("");
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        Google Calendar / 大学公式の ICS ファイルをアップロードすると、試験・休講・予定として読み込みます。
      </p>

      {!preview && (
        <label
          className={`block cursor-pointer rounded-lg border border-dashed border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-950 px-4 py-3 text-center text-sm transition ${pending ? "opacity-50" : "hover:border-sky-500"}`}
        >
          <input
            type="file"
            accept=".ics,text/calendar,text/plain"
            className="hidden"
            disabled={pending}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {pending ? "読み込み中..." : "ICS ファイルを選択"}
        </label>
      )}

      {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
      {message && <p className="mt-2 text-xs text-emerald-500">{message}</p>}

      {preview && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">
            {filename ? `${filename} — ` : ""}
            {preview.length} 件のイベントが見つかりました
          </p>
          {preview.length > 0 ? (
            <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2 text-xs">
              {preview.slice(0, 100).map((p, i) => (
                <li
                  key={`${p.date}-${i}`}
                  className="flex items-center gap-2 text-slate-700 dark:text-slate-300"
                >
                  <span className="tabular-nums text-slate-500">
                    {new Date(p.date).toLocaleDateString("ja-JP", {
                      timeZone: "Asia/Tokyo",
                      month: "2-digit",
                      day: "2-digit",
                    })}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      p.kind === "EXAM"
                        ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                        : p.kind === "HOLIDAY"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "bg-sky-500/10 text-sky-700 dark:text-sky-300"
                    }`}
                  >
                    {KIND_LABEL[p.kind]}
                  </span>
                  <span className="truncate">{p.title}</span>
                </li>
              ))}
              {preview.length > 100 && (
                <li className="text-center text-slate-500">…他 {preview.length - 100} 件</li>
              )}
            </ul>
          ) : (
            <p className="mb-3 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2 text-xs text-slate-500">
              VEVENT が見つかりませんでした
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onImport}
              disabled={pending || preview.length === 0}
              className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "インポート中..." : `${preview.length} 件を取り込み`}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50"
            >
              やり直す
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
