"use client";

// 学年歴インポート UI(設定画面に組み込み)。
// 2 つの取り込み方式:
//   1. ICS ファイルアップロード(汎用)
//   2. 千葉工業大学 学生資料室の学年歴 PDF を自動取得・パース(専用)
// どちらも dryRun でプレビュー → 確認 → 本番 import の2段階。

import { useState } from "react";

type Preview = {
  title: string;
  date: string; // ISO
  kind: "EXAM" | "HOLIDAY" | "EVENT";
};

type Mode = "ics" | "cit";

const KIND_LABEL: Record<Preview["kind"], string> = {
  EXAM: "試験",
  HOLIDAY: "休日",
  EVENT: "予定",
};

export function AcademicImport() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [icsText, setIcsText] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [academicYear, setAcademicYear] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMode(null);
    setIcsText("");
    setFilename("");
    setPreview(null);
    setAcademicYear(null);
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
    setIcsText(t);
    setFilename(file.name);
    setMode("ics");
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

  const onCitPreview = async () => {
    setError(null);
    setMessage(null);
    setPreview(null);
    setMode("cit");
    setPending(true);
    try {
      const res = await fetch("/api/academic/import-cit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `取得失敗 (${res.status})`);
        return;
      }
      setPreview(body.preview ?? []);
      if (typeof body.academicYear === "number") setAcademicYear(body.academicYear);
    } finally {
      setPending(false);
    }
  };

  const onImport = async () => {
    if (!preview || !mode) return;
    setPending(true);
    setError(null);
    try {
      const url = mode === "cit" ? "/api/academic/import-cit" : "/api/academic/import";
      const body =
        mode === "cit"
          ? {}
          : { text: icsText, source: filename || "ics" };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `インポート失敗 (${res.status})`);
        return;
      }
      setMessage(
        `インポート完了: 追加 ${json.inserted ?? 0} 件 / スキップ(重複)${json.skipped ?? 0} 件`,
      );
      setMode(null);
      setIcsText("");
      setFilename("");
      setPreview(null);
      setAcademicYear(null);
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        試験・休講・大学行事を読み込みます。同日同タイトルは重複として自動スキップ。
      </p>

      {!preview && (
        <div className="space-y-2">
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
            {pending && mode === "ics" ? "読み込み中..." : "ICS ファイルを選択"}
          </label>
          <button
            type="button"
            onClick={() => void onCitPreview()}
            disabled={pending}
            className="block w-full rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-center text-sm font-medium text-sky-700 dark:text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50"
          >
            {pending && mode === "cit"
              ? "取得中..."
              : "🏫 千葉工大の学年歴を自動取得"}
          </button>
          <p className="text-[11px] text-slate-500">
            学生資料室の PDF をパースします。①②(丸数字)エントリは取りこぼされます。
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
      {message && <p className="mt-2 text-xs text-emerald-500">{message}</p>}

      {preview && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">
            {mode === "cit" && academicYear ? `${academicYear}年度 — ` : null}
            {mode === "ics" && filename ? `${filename} — ` : null}
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
              イベントが見つかりませんでした
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void onImport()}
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
