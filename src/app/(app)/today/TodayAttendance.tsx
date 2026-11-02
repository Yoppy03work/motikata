"use client";

// 今日の出席セクション (today ページに差し込む)。
// - confirm: 「出席する」→ QR スキャン → /api/attendance/submit で実送信
// - manual : 「自分で出席済みにする」→ /api/attendance/manual (ローカル記録のみ)
// スタイルは today ページの他カードに合わせた slate/sky Tailwind。

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { fetchJsonOrNull } from "@/lib/fetchJson";
import { CompletionModal } from "@/components/CompletionModal";

const AttendanceQrScanner = dynamic(
  () => import("./AttendanceQrScanner").then((m) => m.AttendanceQrScanner),
  { ssr: false },
);

type ClassItem = {
  id: number;
  period: number;
  endPeriod: number;
  courseName: string;
  classroom: string | null;
  startTime: string;
  endTime: string | null;
  blockHead: boolean;
  done: boolean;
  inWindow: boolean;
};

type TodayResponse = {
  ok: true;
  date: string;
  mode: "manual" | "confirm" | "auto";
  hasCreds: boolean;
  classes: ClassItem[];
};

export function TodayAttendance() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scanningFor, setScanningFor] = useState<ClassItem | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [done, setDone] = useState<{ title: string; key: string } | null>(null);

  const load = useCallback(async () => {
    const body = await fetchJsonOrNull<TodayResponse>("/api/attendance/today");
    if (body) setData(body);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let ignore = false;
    void fetchJsonOrNull<TodayResponse>("/api/attendance/today").then((body) => {
      if (ignore) return;
      if (body) setData(body);
      setLoaded(true);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const recordManual = async (c: ClassItem) => {
    if (!data) return;
    setPendingId(c.id);
    setMessage(null);
    try {
      const res = await fetch("/api/attendance/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classScheduleId: c.id, classDateYmd: data.date }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: body.message ?? `失敗 (${res.status})`, error: true });
        return;
      }
      setDone({ title: `${c.courseName} を出席済みに`, key: `m-${c.id}` });
      await load();
    } finally {
      setPendingId(null);
    }
  };

  const onScanResult = async (qr: string) => {
    const c = scanningFor;
    setScanningFor(null);
    if (!c || !data) return;
    setPendingId(c.id);
    setMessage(null);
    try {
      const res = await fetch("/api/attendance/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classScheduleId: c.id, classDateYmd: data.date, qr }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: body.message ?? `出席に失敗しました (${res.status})`, error: true });
        return;
      }
      setDone({ title: `${c.courseName} の出席を送信`, key: `c-${c.id}` });
      await load();
    } finally {
      setPendingId(null);
    }
  };

  // 授業が無い日はセクションごと非表示 (today ページをすっきり保つ)
  if (!loaded || !data || data.classes.length === 0) return null;

  const blocks = data.classes.filter((c) => c.blockHead);

  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">今日の出席</h2>
        <Link href="/settings" className="text-xs text-slate-500 hover:text-sky-500">
          出席モード: {modeLabel(data.mode)}
        </Link>
      </div>

      {!data.hasCreds && (
        <p className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          CIT 認証情報が未登録です。
          <Link href="/settings" className="ml-1 underline">
            設定
          </Link>
          から登録すると「出席する」で自動送信できます。
        </p>
      )}

      <ul className="space-y-2">
        {blocks.map((c) => (
          <li
            key={c.id}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {c.courseName}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {c.period === c.endPeriod ? `${c.period}限` : `${c.period}-${c.endPeriod}限`}
                  <span className="mx-1">·</span>
                  {c.startTime}
                  {c.endTime ? `–${c.endTime}` : ""}
                  {c.classroom ? (
                    <>
                      <span className="mx-1">·</span>
                      {c.classroom}
                    </>
                  ) : null}
                </p>
              </div>
              {c.done ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-600 dark:text-sky-300">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                  出席済み
                </span>
              ) : (
                <span className="shrink-0 text-[11px] text-slate-400">
                  {c.inWindow ? "出席できます" : "時間外"}
                </span>
              )}
            </div>

            {!c.done && (
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  disabled={pendingId === c.id || !data.hasCreds}
                  onClick={() => setScanningFor(c)}
                  className="flex-1 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {pendingId === c.id ? "送信中…" : "出席する (QR)"}
                </button>
                <button
                  type="button"
                  disabled={pendingId === c.id}
                  onClick={() => void recordManual(c)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 disabled:opacity-50"
                >
                  手動で済みに
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {message && (
        <p className={`mt-2 text-xs ${message.error ? "text-rose-500" : "text-sky-500"}`}>
          {message.text}
        </p>
      )}

      {scanningFor && (
        <AttendanceQrScanner onResult={(t) => void onScanResult(t)} onClose={() => setScanningFor(null)} />
      )}

      <CompletionModal
        open={done !== null}
        title={done?.title ?? ""}
        seedKey={done?.key ?? ""}
        onClose={() => setDone(null)}
      />
    </section>
  );
}

function modeLabel(mode: "manual" | "confirm" | "auto"): string {
  return mode === "manual" ? "手動" : mode === "confirm" ? "確認して送信" : "自動";
}
