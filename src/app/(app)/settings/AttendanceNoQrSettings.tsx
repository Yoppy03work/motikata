"use client";

// 「QR なしで送信」を許可する授業の設定。
// 出席 QR は教室にいることの確認なので、先生から QR なしでよいと許可を得た授業だけ追加する。
// 追加するときは許可の出どころのメモを必須にして、あとから見返せるようにする。

import { useEffect, useState } from "react";
import { fetchJsonOrNull } from "@/lib/fetchJson";

type Course = { courseName: string; classroom: string | null; derivedRoomId: string | null };
type Enabled = { courseName: string; note: string; roomId?: string; enabledAt: string };
type Response = { courses: Course[]; enabled: Enabled[] };

const inputClass =
  "min-w-0 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-hidden focus:ring-2 focus:ring-sky-500";

export function AttendanceNoQrSettings() {
  const [data, setData] = useState<Response | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [roomId, setRoomId] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let ignore = false;
    void fetchJsonOrNull<Response>("/api/attendance/no-qr").then((body) => {
      if (!ignore && body) setData(body);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const save = async (next: Omit<Enabled, "enabledAt">[]) => {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/attendance/no-qr", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courses: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: json.message ?? `保存失敗 (${res.status})`, error: true });
        return false;
      }
      setData((d) => (d ? { ...d, enabled: json.enabled } : d));
      setMessage({ text: "保存しました", error: false });
      return true;
    } finally {
      setPending(false);
    }
  };

  const current = () =>
    (data?.enabled ?? []).map(({ courseName, note, roomId }) => ({ courseName, note, roomId }));

  const startEdit = (c: Course) => {
    const e = data?.enabled.find((x) => x.courseName === c.courseName);
    setEditing(c.courseName);
    setNote(e?.note ?? "");
    setRoomId(e?.roomId ?? "");
    setMessage(null);
  };

  const submitEdit = async () => {
    if (!editing) return;
    const entry = { courseName: editing, note: note.trim(), roomId: roomId.trim() || undefined };
    const rest = current().filter((x) => x.courseName !== editing);
    if (await save([...rest, entry])) setEditing(null);
  };

  const disable = (courseName: string) => {
    void save(current().filter((x) => x.courseName !== courseName));
  };

  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 text-xs">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">QR なしで送信する授業</p>
      <p className="mt-0.5 text-slate-500">
        先生から「QR なしでよい」と許可をもらった授業だけ追加してください。追加した授業は「今日」画面のボタン 1 つで、時間割の教室で出席を送ります (授業の時間内・学内ネットワークのときだけ)。
      </p>

      {data === null ? (
        <p className="mt-2 text-slate-500">読み込み中…</p>
      ) : data.courses.length === 0 ? (
        <p className="mt-2 text-slate-500">時間割に授業がありません。</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
          {data.courses.map((c) => {
            const e = data.enabled.find((x) => x.courseName === c.courseName);
            const room = e?.roomId ?? c.derivedRoomId;
            return (
              <li key={c.courseName} className="py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-800 dark:text-slate-200">{c.courseName}</p>
                    <p className="mt-0.5 text-slate-500">
                      {c.classroom ?? "教室なし"}
                      <span className="mx-1">→</span>
                      {room ? `教室番号 ${room}` : "教室番号不明"}
                    </p>
                    {e && (
                      <p className="mt-0.5 text-emerald-600 dark:text-emerald-400">
                        許可: {e.note}
                      </p>
                    )}
                  </div>
                  {editing !== c.courseName && (
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => startEdit(c)}
                        className="rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-slate-700 dark:text-slate-300 disabled:opacity-50"
                      >
                        {e ? "編集" : "追加"}
                      </button>
                      {e && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => disable(c.courseName)}
                          className="rounded-md px-2 py-1 text-rose-500 disabled:opacity-50"
                        >
                          解除
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {editing === c.courseName && (
                  <div className="mt-2 space-y-1.5">
                    <input
                      value={note}
                      onChange={(ev) => setNote(ev.target.value)}
                      placeholder="許可の出どころ (例: 11/3 授業後に先生に確認)"
                      maxLength={200}
                      disabled={pending}
                      className={`${inputClass} w-full`}
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        value={roomId}
                        onChange={(ev) => setRoomId(ev.target.value)}
                        placeholder={c.derivedRoomId ? `教室番号 (空なら ${c.derivedRoomId})` : "教室番号 (例 6104)"}
                        maxLength={32}
                        disabled={pending}
                        className={`${inputClass} flex-1`}
                      />
                      <button
                        type="button"
                        onClick={() => void submitEdit()}
                        disabled={pending || note.trim().length === 0 || (!roomId.trim() && !c.derivedRoomId)}
                        className="rounded-md bg-sky-500 px-3 py-1.5 font-medium text-white disabled:opacity-50"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        disabled={pending}
                        className="rounded-md px-2 py-1.5 text-slate-500"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
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
