"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TZ } from "@/lib/tz";
import { CompletionModal } from "@/components/CompletionModal";
import type { TodayItem } from "./types";

// notes 内の URL を anchor 化するためのヘルパ。
// notes 例: "manaba: https://cit.manaba.jp/ct/course_xxx_query_yyy"
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
function renderWithLinks(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    const url = m[0];
    parts.push(
      <a
        key={`u-${m.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="break-all text-sky-600 dark:text-sky-400 underline underline-offset-2"
      >
        {url}
      </a>,
    );
    lastIdx = m.index + url.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

const priorityLabel: Record<TodayItem["priority"], string> = {
  HIGH: "高",
  MID: "中",
  LOW: "低",
};

const priorityTone: Record<TodayItem["priority"], string> = {
  HIGH: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  MID: "border-slate-400 dark:border-slate-600 bg-slate-300/40 dark:bg-slate-700/40 text-slate-700 dark:text-slate-300",
  LOW: "border-slate-300 dark:border-slate-700 bg-slate-200/40 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400",
};

export function TodayItemCard({
  item,
  prepareMode = false,
}: {
  item: TodayItem;
  prepareMode?: boolean;
}) {
  const router = useRouter();
  const [checklist, setChecklist] = useState(item.checklist);
  // 「閉じた状態」を done フラグで表現。DONE だけでなく SKIPPED も含む。
  // (groupByAxis 側で SKIPPED は done バケットに分類されるが、ここで
  //  status === "DONE" だけ見ると SKIPPED のカードに snooze ボタン等が
  //  残ってしまい、閉じたはずのタスクに通知フローを再投入してしまう)
  const [done, setDone] = useState(item.status !== "OPEN");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  const due = new Date(item.dueAt);
  const isEvent = item.itemType === "EVENT";

  const toggleCheck = (id: number) => {
    const target = checklist.find((c) => c.id === id);
    if (!target) return;
    const nextChecked = !target.checked;
    // Optimistic
    setChecklist((prev) => prev.map((c) => (c.id === id ? { ...c, checked: nextChecked } : c)));
    startTransition(async () => {
      const res = await fetch(`/api/checklist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: nextChecked }),
      });
      if (!res.ok) {
        // Revert
        setChecklist((prev) => prev.map((c) => (c.id === id ? { ...c, checked: !nextChecked } : c)));
        setError("更新に失敗しました");
      }
    });
  };

  const complete = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${item.id}/complete`, { method: "POST" });
      if (res.ok) {
        setDone(true);
        setCelebrate(true);
        router.refresh();
      } else {
        setError("完了処理に失敗しました");
      }
    });
  };

  const uncomplete = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${item.id}/uncomplete`, { method: "POST" });
      if (res.ok) {
        setDone(false);
        router.refresh();
      } else {
        setError("更新に失敗しました");
      }
    });
  };

  const snooze = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${item.id}/snooze`, { method: "POST" });
      if (res.ok) {
        // Soft signal: 1時間後に通知
        router.refresh();
      } else {
        setError("スヌーズに失敗しました");
      }
    });
  };

  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <>
    <article
      onClick={() => setDetailOpen(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setDetailOpen(true);
        }
      }}
      aria-label={`${item.title} の詳細を開く`}
      className={`cursor-pointer rounded-xl border px-3 py-2.5 transition active:scale-[0.99] ${
        done
          ? "border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 opacity-60"
          : isEvent
            ? "border-sky-900/40 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200/70 dark:hover:bg-slate-900/70"
            : item.required
              ? "border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200/70 dark:hover:bg-slate-900/70"
              : "border-slate-200/60 dark:border-slate-800/60 bg-slate-100/70 dark:bg-slate-900/70 hover:bg-slate-200/70 dark:hover:bg-slate-900/70"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            {/* Phase 14a: 終日イベントは時刻を出さず「終日」表示 */}
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {item.isAllDay ? "終日" : formatInTimeZone(due, APP_TZ, "HH:mm")}
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                isEvent
                  ? "bg-sky-500/15 text-sky-300"
                  : item.required
                    ? "bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                    : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
              }`}
            >
              {isEvent ? "予定" : item.required ? "必須" : "任意"}
            </span>
            {!isEvent && (
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${priorityTone[item.priority]}`}
              >
                {priorityLabel[item.priority]}
              </span>
            )}
            {item.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-md bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-700 dark:text-slate-300"
                style={t.color ? { color: t.color } : undefined}
              >
                {t.name}
              </span>
            ))}
          </div>
          <h3
            className={`mt-0.5 line-clamp-2 break-words text-sm font-semibold leading-snug ${done ? "line-through" : ""}`}
          >
            {item.title}
          </h3>
        </div>
      </div>

      {checklist.length > 0 && (
        <ul className="mt-2 space-y-0.5" onClick={(e) => e.stopPropagation()}>
          {checklist.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 py-0.5 touch-manipulation">
                <input
                  type="checkbox"
                  checked={c.checked}
                  onChange={() => toggleCheck(c.id)}
                  disabled={pending && false /* don't block UX */}
                  className="h-4 w-4 rounded border-slate-400 dark:border-slate-600 bg-slate-200 dark:bg-slate-800 accent-sky-500"
                />
                <span className={`text-xs ${c.checked ? "text-slate-500 line-through" : ""}`}>
                  {c.label}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {!done && !prepareMode && !isEvent && (
        <div className="mt-2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={complete}
            disabled={pending}
            className="flex-1 rounded-md bg-sky-500 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50"
          >
            完了
          </button>
          <button
            onClick={snooze}
            disabled={pending}
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 disabled:opacity-50"
          >
            1時間後に
          </button>
        </div>
      )}

      {done && !prepareMode && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={uncomplete}
            disabled={pending}
            className="text-[11px] text-slate-600 dark:text-slate-400 underline-offset-2 hover:underline disabled:opacity-50"
          >
            完了を取り消す
          </button>
        </div>
      )}

      {prepareMode && checklist.length > 0 && (
        <p className="mt-1 text-[11px] text-sky-300/80">
          今夜のうちにカバンに入れておく持ち物
        </p>
      )}

      {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
    </article>
    {detailOpen && (
      <DetailModal
        item={item}
        due={due}
        done={done}
        isEvent={isEvent}
        pending={pending}
        onComplete={complete}
        onUncomplete={uncomplete}
        onSnooze={snooze}
        onClose={() => setDetailOpen(false)}
      />
    )}
    <CompletionModal
      open={celebrate}
      title={item.title}
      seedKey={String(item.id)}
      onClose={() => setCelebrate(false)}
    />
    </>
  );
}

function DetailModal({
  item,
  due,
  done,
  isEvent,
  pending,
  onComplete,
  onUncomplete,
  onSnooze,
  onClose,
}: {
  item: TodayItem;
  due: Date;
  done: boolean;
  isEvent: boolean;
  pending: boolean;
  onComplete: () => void;
  onUncomplete: () => void;
  onSnooze: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [priority, setPriority] = useState<TodayItem["priority"]>(item.priority);
  const [savingPriority, setSavingPriority] = useState(false);
  const [priorityError, setPriorityError] = useState<string | null>(null);

  // Esc で閉じる + 背景スクロール固定
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const updatePriority = async (next: TodayItem["priority"]) => {
    if (next === priority) return;
    setSavingPriority(true);
    setPriorityError(null);
    const prev = priority;
    setPriority(next); // optimistic
    try {
      const res = await fetch(`/api/tasks/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: next }),
      });
      if (!res.ok) {
        setPriority(prev);
        const body = await res.json().catch(() => ({}));
        setPriorityError(
          typeof body.error === "string" ? body.error : `更新失敗 (${res.status})`,
        );
        return;
      }
      // Phase 14c: PATCH 成功でも Google 側 push が失敗するケース (5xx, conflict 等)
      // を body から拾ってユーザーに伝える。
      // - googleConflict (412): Google 側で別更新あり → 「同期してから再編集」
      // - googlePushError: Google push 失敗 (auth / rate / network 等)
      // ローカル更新は維持されているので "warning" 的に表示する。
      const body = await res.json().catch(() => ({})) as {
        googleConflict?: boolean;
        googlePushError?: string;
      };
      if (body.googleConflict) {
        setPriorityError(
          "Google 側で先に別の更新が入っています。同期 (/settings → 今すぐ同期) してから再編集してください",
        );
      } else if (body.googlePushError) {
        setPriorityError(
          `ローカルは保存しましたが Google 反映に失敗: ${body.googlePushError}`,
        );
      }
      // 並び順が変わるので RSC を refresh
      router.refresh();
    } finally {
      setSavingPriority(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
              <span className="tabular-nums">
                {/* Phase 14a.1: 終日イベントは時刻を出さず日付のみ */}
                {item.isAllDay
                  ? formatInTimeZone(due, APP_TZ, "M月d日 (EEE)")
                  : formatInTimeZone(due, APP_TZ, "M月d日 (EEE) HH:mm")}
              </span>
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                  isEvent
                    ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                    : item.required
                      ? "bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                      : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                }`}
              >
                {isEvent ? "予定" : item.required ? "必須" : "任意"}
              </span>
              {!isEvent && (
                <span
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${priorityTone[priority]}`}
                >
                  優先度 {priorityLabel[priority]}
                </span>
              )}
              <span className="rounded-md bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-400">
                {item.source}
              </span>
            </div>
            <h2
              className={`mt-2 break-words text-lg font-semibold leading-snug ${done ? "line-through opacity-60" : ""}`}
            >
              {item.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            aria-label="閉じる"
          >
            閉じる
          </button>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto">
          {!isEvent && (
            <div className="mb-3">
              <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                優先度
              </h3>
              <div className="flex gap-1.5">
                {(["HIGH", "MID", "LOW"] as const).map((p) => {
                  const active = priority === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={savingPriority}
                      onClick={() => void updatePriority(p)}
                      aria-pressed={active}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                        active
                          ? p === "HIGH"
                            ? "border-rose-500 bg-rose-500/15 text-rose-700 dark:text-rose-300"
                            : p === "MID"
                              ? "border-slate-500 bg-slate-500/15 text-slate-700 dark:text-slate-300"
                              : "border-slate-500 bg-slate-500/15 text-slate-700 dark:text-slate-300"
                          : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-600"
                      }`}
                    >
                      {p === "HIGH" ? "高" : p === "MID" ? "中" : "低"}
                    </button>
                  );
                })}
              </div>
              {priorityError && (
                <p className="mt-1 text-[11px] text-rose-500">{priorityError}</p>
              )}
            </div>
          )}

          {item.tags.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {item.tags.map((t) => (
                <span
                  key={t.id}
                  className="rounded-md bg-slate-200 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-300"
                  style={t.color ? { color: t.color } : undefined}
                >
                  #{t.name}
                </span>
              ))}
            </div>
          )}

          {item.subtitle && (
            <div className="mb-3">
              <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                メモ
              </h3>
              <div className="whitespace-pre-wrap break-words rounded-lg bg-slate-100 dark:bg-slate-900 p-3 text-sm text-slate-800 dark:text-slate-200">
                {renderWithLinks(item.subtitle)}
              </div>
            </div>
          )}

          {item.checklist.length > 0 && (
            <div className="mb-3">
              <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                チェックリスト
              </h3>
              <ul className="space-y-0.5">
                {item.checklist.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded border ${c.checked ? "bg-sky-500 border-sky-500" : "border-slate-400 dark:border-slate-600 bg-slate-200 dark:bg-slate-800"}`}
                      aria-hidden
                    />
                    <span className={c.checked ? "text-slate-500 line-through" : ""}>
                      {c.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!item.subtitle && item.checklist.length === 0 && item.tags.length === 0 && (
            <p className="text-xs text-slate-500">追加情報はありません</p>
          )}
        </div>

        {/* アクションボタン: 明日の準備モードでも詳細モーダルからは完了させたい */}
        {!isEvent && (
          <div className="mt-3 flex gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
            {!done ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onComplete();
                    onClose();
                  }}
                  disabled={pending}
                  className="flex-1 rounded-md bg-sky-500 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-sky-600"
                >
                  完了
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSnooze();
                  }}
                  disabled={pending}
                  className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  1時間後に
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onUncomplete();
                }}
                disabled={pending}
                className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 text-sm text-slate-700 dark:text-slate-300 disabled:opacity-50 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                完了を取り消す
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
