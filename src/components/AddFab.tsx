"use client";

// 全ページ共通の「+ 追加」フローティングアクションボタン。
// 流れ:
//   FAB タップ → タイプ + 日付選択シート → TaskForm でフォーム入力 → 保存
// 設定 / メモ / 時間割 など追加対象がない画面では非表示。

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { TaskForm } from "./TaskForm";

const HIDDEN_PREFIXES = ["/settings", "/memo", "/classes", "/templates", "/login"];

function todayJstYmd(): string {
  // JST の今日 (YYYY-MM-DD)
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // "YYYY-MM-DD"
}

export function AddFab() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"choose" | "form">("choose");
  const [itemType, setItemType] = useState<"TASK" | "EVENT">("TASK");
  const [ymd, setYmd] = useState<string>(todayJstYmd());

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  // 表示する pathname だけ FAB を出す
  const hidden = HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));
  if (hidden) return null;

  const startAdd = (type: "TASK" | "EVENT") => {
    setItemType(type);
    // 直前にユーザが選んだ日付(ymd state)をそのまま TaskForm に渡す。
    // 以前は todayJstYmd() で上書きしてしまうバグがあった。
    setStep("form");
  };

  const openSheet = () => {
    // 開くたびに「今日」にリセット(初期値として親切)。
    setYmd(todayJstYmd());
    setOpen(true);
    setStep("choose");
  };

  const close = () => {
    setOpen(false);
    setStep("choose");
  };

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label="タスク・予定を追加"
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg shadow-sky-500/30 hover:bg-sky-600 active:scale-95 transition"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={close}
        >
          {/*
            iOS Safari は下部ツールバー出現時に 100vh が画面より大きく評価され
            モーダル下端がはみ出るため、dvh(dynamic viewport height)を使う。
            また左右に min(env(safe-area-inset-*), 0.5rem) 相当の 視覚マージンも入れる
            (bottom sheet は完全な画面幅でも良いが、上端の rounded が角だけになって
            もったいないので少し内側に)
          */}
          <div
            className="flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl sm:max-h-[90dvh] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" />
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="min-w-0 truncate text-lg font-semibold">
                {step === "choose" ? "追加" : itemType === "TASK" ? "タスクを追加" : "予定を追加"}
              </h2>
              <button
                type="button"
                onClick={close}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                閉じる
              </button>
            </div>

            {step === "choose" && (
              <div className="space-y-3 pb-2">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  どちらを追加しますか?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => startAdd("TASK")}
                    className="flex flex-col items-start gap-1 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-left transition hover:bg-sky-500/15 active:scale-[0.99]"
                  >
                    <span className="text-base font-semibold text-sky-700 dark:text-sky-300">
                      タスク
                    </span>
                    <span className="text-[11px] text-slate-600 dark:text-slate-400">
                      締切ありの ToDo(必須/任意・優先度)
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startAdd("EVENT")}
                    className="flex flex-col items-start gap-1 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-left transition hover:bg-sky-500/15 active:scale-[0.99]"
                  >
                    <span className="text-base font-semibold text-sky-700 dark:text-sky-300">
                      予定
                    </span>
                    <span className="text-[11px] text-slate-600 dark:text-slate-400">
                      時間が決まっている用事(授業以外)
                    </span>
                  </button>
                </div>
                <label className="block">
                  <span className="text-xs text-slate-600 dark:text-slate-400">日付</span>
                  <input
                    type="date"
                    value={ymd}
                    onChange={(e) => setYmd(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </label>
              </div>
            )}

            {step === "form" && (
              <div className="overflow-y-auto">
                <TaskForm
                  ymd={ymd}
                  itemType={itemType}
                  onCancel={() => setStep("choose")}
                  onSaved={async () => {
                    close();
                    router.refresh();
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
