"use client";

// manaba 締切前の提出チェック時刻(アラーム)。
// 「締切の N 分前」を追加・削除でき、変更はすぐ保存されて既存の課題にも反映される。

import { useEffect, useState } from "react";
import { fetchJsonOrNull } from "@/lib/fetchJson";
import { formatMinutes } from "@/lib/formatMinutes";

const UNITS = [
  { value: 1, label: "分" },
  { value: 60, label: "時間" },
  { value: 1440, label: "日" },
] as const;

const MAX_OFFSET_MIN = 7 * 1440;
const MAX_ALERTS = 10;

export function DeadlineAlertSettings() {
  const [offsets, setOffsets] = useState<number[] | null>(null);
  const [amount, setAmount] = useState("30");
  const [unit, setUnit] = useState<number>(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    void fetchJsonOrNull<{ offsets: number[] }>("/api/manaba/deadline-alerts").then((body) => {
      if (!ignore && body) setOffsets(body.offsets);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const save = async (next: number[]) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/manaba/deadline-alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offsets: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `保存失敗 (${res.status})`);
        return;
      }
      setOffsets(body.offsets);
    } finally {
      setPending(false);
    }
  };

  const add = () => {
    if (!offsets) return;
    const n = Number(amount);
    const min = n * unit;
    if (!Number.isInteger(n) || n < 1) {
      setError("1 以上の整数を入力してください");
      return;
    }
    if (min > MAX_OFFSET_MIN) {
      setError("7 日前までにしてください");
      return;
    }
    if (offsets.includes(min)) {
      setError("同じ時刻がすでにあります");
      return;
    }
    void save([...offsets, min]);
  };

  const remove = (min: number) => {
    if (!offsets) return;
    void save(offsets.filter((o) => o !== min));
  };

  const full = (offsets?.length ?? 0) >= MAX_ALERTS;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 text-xs">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">締切前の提出チェック</p>
      <p className="mt-0.5 text-slate-500">
        設定した時刻に manaba で提出状況を確認し、未提出なら「通知先」に通知します。提出済みなら通知せず完了にします。
      </p>

      {offsets === null ? (
        <p className="mt-2 text-slate-500">読み込み中…</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {offsets.length === 0 && <li className="text-amber-600 dark:text-amber-400">チェックしません(通知なし)</li>}
          {offsets.map((min) => (
            <li
              key={min}
              className="flex items-center justify-between rounded-md border border-slate-200 dark:border-slate-800 px-3 py-2"
            >
              <span className="text-sm text-slate-800 dark:text-slate-200">
                締切の <span className="font-semibold">{formatMinutes(min)}</span> 前
              </span>
              <button
                type="button"
                onClick={() => remove(min)}
                disabled={pending}
                aria-label={`締切の ${formatMinutes(min)} 前を削除`}
                className="rounded-md px-2 py-1 text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

      {offsets !== null && !full && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-slate-600 dark:text-slate-400">締切の</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
            aria-label="何分・何時間・何日前か"
            className="w-16 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-hidden focus:ring-2 focus:ring-sky-500"
          />
          <select
            value={unit}
            onChange={(e) => setUnit(Number(e.target.value))}
            disabled={pending}
            aria-label="単位"
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
          >
            {UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
          <span className="text-slate-600 dark:text-slate-400">前</span>
          <button
            type="button"
            onClick={add}
            disabled={pending}
            className="ml-auto rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            ＋ 追加
          </button>
        </div>
      )}
      {full && <p className="mt-2 text-slate-500">最大 {MAX_ALERTS} 個までです</p>}
      {error && <p className="mt-2 text-rose-500">{error}</p>}
    </div>
  );
}
