"use client";

// タスク完了時に表示する祝福モーダル。
// - チェックの円アニメーション + 完了したタスク名 + 一言メッセージ
// - 3.0 秒で自動 dismiss、タップ or 「閉じる」ボタンで即閉じる
// - 連打されても直前のモーダルに上書きされる(key で再マウント)

import { useEffect, useState } from "react";

const PHRASES = [
  "お疲れさま!",
  "1つ片付いたね",
  "ナイス!",
  "いい調子",
  "やったね",
  "順調順調",
  "進んでる!",
];

function pickPhrase(seed: string): string {
  // タスクIDなどを seed にして同じ完了は同じ文言、別の完了は変わるように
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % PHRASES.length;
  return PHRASES[idx];
}

const AUTO_CLOSE_MS = 3000;

export function CompletionModal({
  open,
  title,
  seedKey,
  onClose,
}: {
  open: boolean;
  title: string;
  /** 同じ完了は同じメッセージ、別の完了は別のメッセージにするための seed (通常は item.id.toString()) */
  seedKey: string;
  onClose: () => void;
}) {
  const [phrase, setPhrase] = useState("");

  useEffect(() => {
    if (!open) return;
    setPhrase(pickPhrase(seedKey));
    const timer = setTimeout(() => onClose(), AUTO_CLOSE_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, seedKey, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-live="polite"
      aria-label="タスク完了"
    >
      <div
        className="mx-4 flex w-full max-w-xs flex-col items-center rounded-2xl border border-sky-500/30 bg-white dark:bg-slate-950 p-6 shadow-2xl shadow-sky-500/10 animate-[popIn_200ms_cubic-bezier(0.34,1.56,0.64,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* チェック円 */}
        <div className="relative mb-3 flex h-16 w-16 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-sky-500/15 animate-[ping_900ms_ease-out_1]" />
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-sky-500 text-white">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="animate-[checkDraw_300ms_ease-out_80ms_both]"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        </div>

        <p className="text-xl font-bold text-slate-900 dark:text-slate-100">完了!</p>
        <p className="mt-1 text-xs text-sky-600 dark:text-sky-300">{phrase}</p>

        <p className="mt-3 line-clamp-2 break-words text-center text-sm text-slate-700 dark:text-slate-300">
          {title}
        </p>

        {/* 自動クローズの進捗バー */}
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <span
            className="block h-full bg-sky-500"
            style={{ animation: `progressShrink ${AUTO_CLOSE_MS}ms linear forwards` }}
          />
        </div>

        {/* 閉じるボタン(自動クローズ前にすぐ閉じたい人向け) */}
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-[0.98] transition"
        >
          閉じる
        </button>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes popIn {
          0% {
            opacity: 0;
            transform: scale(0.85);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes checkDraw {
          0% {
            stroke-dasharray: 0 30;
          }
          100% {
            stroke-dasharray: 30 30;
          }
        }
        @keyframes progressShrink {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
      `}</style>
    </div>
  );
}
