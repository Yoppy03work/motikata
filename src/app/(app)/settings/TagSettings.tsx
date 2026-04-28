"use client";

// タグ管理 UI。
// 一覧 + 新規追加(名前 + カラー) + その場で編集削除。

import { useCallback, useEffect, useState } from "react";

type Tag = {
  id: number;
  name: string;
  color: string | null;
};

const PRESET_COLORS = [
  "#0ea5e9", // sky
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#6366f1", // indigo
  "#14b8a6", // teal
];

export function TagSettings() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(PRESET_COLORS[0]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tags");
      if (res.ok) {
        const body = await res.json();
        setTags(body.tags ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    if (!newName.trim()) {
      setError("名前を入力してください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : `失敗 (${res.status})`);
        return;
      }
      setNewName("");
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const updateTag = async (id: number, patch: Partial<Tag>) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : `失敗 (${res.status})`);
        return;
      }
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const removeTag = async (id: number, name: string) => {
    if (!confirm(`タグ「${name}」を削除します(関連する紐付けも消えます)。続けますか?`))
      return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(`削除失敗 (${res.status})`);
        return;
      }
      await refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        授業や課題に色付きタグを付けて分類できます(例: 数学 / 実験 / レポート)
      </p>

      {/* 新規追加 */}
      <div className="mb-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2.5">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={pending}
            placeholder="タグ名(例: 数学)"
            className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={pending || !newName.trim()}
            className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            追加
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setNewColor(c)}
              aria-label={`色 ${c}`}
              aria-pressed={newColor === c}
              className={`h-6 w-6 rounded-full border-2 ${newColor === c ? "border-slate-900 dark:border-white" : "border-transparent"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-rose-500">{error}</p>}

      {/* 一覧 */}
      {loading ? (
        <p className="text-xs text-slate-500">読み込み中…</p>
      ) : tags.length === 0 ? (
        <p className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-2.5 text-xs text-slate-500">
          まだタグがありません
        </p>
      ) : (
        <ul className="space-y-1.5">
          {tags.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2"
            >
              <span
                className="inline-block h-4 w-4 shrink-0 rounded-full border border-slate-300 dark:border-slate-700"
                style={{ backgroundColor: t.color ?? "transparent" }}
              />
              <input
                type="text"
                defaultValue={t.name}
                onBlur={(e) => {
                  const next = e.currentTarget.value.trim();
                  if (next && next !== t.name) void updateTag(t.id, { name: next });
                }}
                disabled={pending}
                className="flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm focus:border-slate-300 focus:bg-white dark:focus:border-slate-700 dark:focus:bg-slate-900 outline-none"
              />
              <select
                value={t.color ?? ""}
                onChange={(e) => void updateTag(t.id, { color: e.target.value || null })}
                disabled={pending}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-xs"
                aria-label="色"
              >
                <option value="">無色</option>
                {PRESET_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void removeTag(t.id, t.name)}
                disabled={pending}
                className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-[11px] text-rose-600 dark:text-rose-300 disabled:opacity-50"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
