"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJsonOrNull } from "@/lib/fetchJson";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ja } from "date-fns/locale/ja";
import Link from "next/link";
import { APP_TZ } from "@/lib/tz";
import { extractManabaUrl } from "@/lib/manabaUrl";
import { TaskForm } from "./TaskForm";

type Instance = {
  id: number;
  title: string;
  notes: string | null;
  dueAt: string;
  itemType: "TASK" | "EVENT";
  required: boolean;
  priority: "LOW" | "MID" | "HIGH";
  status: "OPEN" | "DONE" | "SKIPPED";
  source: string;
  sourceExternalId: string | null;
  checklist: { id: number; label: string; checkedAt: string | null; orderIdx: number }[];
  tags: { tag: { id: number; name: string; color: string | null } }[];
};

function fetchDayInstances(ymd: string) {
  const q = new URLSearchParams({
    from: `${ymd}T00:00:00+09:00`,
    to: `${ymd}T23:59:59+09:00`,
  });
  return fetchJsonOrNull<{ instances: Instance[] }>(`/api/tasks?${q}`);
}

export function DayDetailSheet({
  open,
  onClose,
  ymd,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  ymd: string;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<Instance[]>([]);
  // 最後に読み込みを終えた日。表示中の日と違えば「読み込み中」(loading は導出する)。
  const [loadedYmd, setLoadedYmd] = useState<string | null>(null);
  const loading = loadedYmd !== ymd;
  const [mode, setMode] = useState<"list" | "add-event" | "add-task">("list");

  // シートは閉じてもマウントされたままなので、開き直したら一覧表示に戻して読み直す。
  // effect で setState すると余分な再描画になるため、描画中に open の変化を見て調整する
  // (React docs「props の変化に応じて state を調整する」のパターン)。
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMode("list");
      setLoadedYmd(null);
    }
  }

  // 追加・編集のあとの再読み込み(一覧は出したまま差し替える)
  const load = useCallback(async () => {
    if (!ymd) return;
    const body = await fetchDayInstances(ymd);
    if (body) setItems(body.instances);
  }, [ymd]);

  useEffect(() => {
    if (!open || !ymd) return;
    let ignore = false;
    void fetchDayInstances(ymd).then((body) => {
      if (ignore) return;
      if (body) setItems(body.instances);
      setLoadedYmd(ymd);
    });
    return () => {
      ignore = true;
    };
  }, [open, ymd]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  // ymd は JST 文脈の "YYYY-MM-DD"。クライアント側の format で日付がずれないよう
  // ローカル深夜の同 y/m/d を作る(format はその y/m/d をそのまま吐く)
  const [yy, mm, dd] = ymd.split("-").map(Number);
  const dateObj = new Date(yy, mm - 1, dd);
  const title = format(dateObj, "M月d日 (EEE)", { locale: ja });

  // 「予定/必須/任意」セクションは未完了(OPEN)のみ。
  // 完了/スキップ済みは別バケツに集約する(月インジケータの集計と挙動を揃える)。
  const openItems = items.filter((i) => i.status === "OPEN");
  const doneItems = items.filter((i) => i.status !== "OPEN");
  const events = openItems
    .filter((i) => i.itemType === "EVENT")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const required = openItems
    .filter((i) => i.itemType === "TASK" && i.required)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const optional = openItems
    .filter((i) => i.itemType === "TASK" && !i.required)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const completed = doneItems.sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Link
            href={`/today?date=${ymd}`}
            className="text-xs text-sky-400 hover:underline"
            onClick={onClose}
          >
            この日を開く →
          </Link>
        </div>

        {mode === "list" && (
          <>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <p className="py-6 text-center text-sm text-slate-500">読み込み中…</p>
              ) : items.length === 0 ? (
                <p className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 p-4 text-sm text-slate-600 dark:text-slate-400">
                  この日はまだ何もありません
                </p>
              ) : (
                <div className="space-y-4">
                  {events.length > 0 && <Group label="予定" items={events} />}
                  {required.length > 0 && <Group label="必須タスク" items={required} />}
                  {optional.length > 0 && <Group label="任意タスク" items={optional} muted />}
                  {events.length === 0 &&
                    required.length === 0 &&
                    optional.length === 0 &&
                    completed.length > 0 && (
                      <p className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 p-3 text-xs text-slate-600 dark:text-slate-400">
                        この日の未完了はありません
                      </p>
                    )}
                  {completed.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-slate-600 dark:text-slate-400">
                        完了済み {completed.length} 件
                      </summary>
                      <ul className="mt-2">
                        <Group label="" items={completed} muted strike />
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode("add-event")}
                className="rounded-lg border border-sky-500/30 bg-sky-500/10 py-2.5 text-sm font-medium text-sky-300"
              >
                + 予定を追加
              </button>
              <button
                onClick={() => setMode("add-task")}
                className="rounded-lg bg-sky-500 py-2.5 text-sm font-medium text-slate-950"
              >
                + タスクを追加
              </button>
            </div>
          </>
        )}

        {(mode === "add-event" || mode === "add-task") && (
          <div className="flex-1 overflow-y-auto">
            <TaskForm
              ymd={ymd}
              itemType={mode === "add-event" ? "EVENT" : "TASK"}
              onCancel={() => setMode("list")}
              onSaved={async () => {
                setMode("list");
                await load();
                onChanged?.();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Group({
  label,
  items,
  muted = false,
  strike = false,
}: {
  label: string;
  items: Instance[];
  muted?: boolean;
  strike?: boolean;
}) {
  return (
    <div className={muted ? "opacity-80" : ""}>
      {label && (
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
          {label}
        </h3>
      )}
      <ul className="space-y-1.5">
        {items.map((it) => {
          const manabaUrl = extractManabaUrl({
            source: it.source,
            sourceExternalId: it.sourceExternalId,
            notes: it.notes,
          });
          return (
            <li
              key={it.id}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  {formatInTimeZone(new Date(it.dueAt), APP_TZ, "HH:mm")}
                </span>
                <span className={`truncate text-sm ${strike ? "line-through" : ""}`}>
                  {it.title}
                </span>
                {it.itemType === "TASK" && !it.required && (
                  <span className="ml-auto rounded-sm bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-400">
                    任意
                  </span>
                )}
                {manabaUrl && (
                  <a
                    href={manabaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="manaba で課題ページを開く"
                    title="manaba で開く"
                    className={`${it.itemType === "TASK" && !it.required ? "" : "ml-auto"} touch-manipulation rounded-sm p-1 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10`}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    <span className="sr-only">manaba で開く</span>
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
