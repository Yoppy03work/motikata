"use client";

// 「QR なしで送信」の設定。スイッチ 1 つで時間割のすべての授業に効く (授業ごとの登録はしない)。
// 教室番号を作れない教室 (研究室名など) だけ一覧に出し、教室ごとに番号を手で入れる。
// 教室名から作れる教室 (731 → 7301 など) は表示しない。

import { useEffect, useState } from "react";
import { fetchJsonOrNull } from "@/lib/fetchJson";

type Classroom = { classroom: string; courses: string[]; derivedRoomId: string | null };
type Settings = { all: boolean; rooms: Record<string, string> };
type Response = Settings & { classrooms: Classroom[] };

const inputClass =
  "min-w-0 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-hidden focus:ring-2 focus:ring-sky-500";

export function AttendanceNoQrSettings() {
  const [data, setData] = useState<Response | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
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

  const save = async (next: Settings) => {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/attendance/no-qr", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: json.message ?? `保存失敗 (${res.status})`, error: true });
        return false;
      }
      setData((d) => (d ? { ...d, all: json.all, rooms: json.rooms } : d));
      setMessage({ text: "保存しました", error: false });
      return true;
    } finally {
      setPending(false);
    }
  };

  const saveRoom = async (classroom: string, value: string) => {
    if (!data) return;
    const rooms = { ...data.rooms };
    if (value.trim()) rooms[classroom] = value.trim();
    else delete rooms[classroom];
    if (await save({ all: data.all, rooms })) setEditing(null);
  };

  // 教室名から番号を作れない教室と、手入力した教室だけ出す
  const needsInput = (data?.classrooms ?? []).filter(
    (c) => !c.derivedRoomId || data?.rooms[c.classroom] !== undefined,
  );

  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 text-xs">
      {data === null ? (
        <p className="text-slate-500">読み込み中…</p>
      ) : (
        <>
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={data.all}
              disabled={pending}
              onChange={(e) => void save({ all: e.target.checked, rooms: data.rooms })}
              className="mt-0.5 h-4 w-4 accent-sky-500"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                QR なしで送信する
              </span>
              <span className="mt-0.5 block text-slate-500">
                すべての授業で、時間割の教室から出席を送ります (授業の時間内・学内ネットワークのときだけ)。時間割が変わってもそのまま使えます。
              </span>
            </span>
          </label>

          {data.all && needsInput.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {needsInput.map((c) => {
                const manual = data.rooms[c.classroom];
                const room = manual ?? c.derivedRoomId;
                return (
                  <li key={c.classroom} className="py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-800 dark:text-slate-200">
                          {c.classroom}
                          {room ? (
                            <span className="ml-1.5 text-slate-500">教室番号 {room}</span>
                          ) : (
                            <span className="ml-1.5 text-amber-600 dark:text-amber-400">教室番号を入力してください</span>
                          )}
                        </p>
                        <p className="mt-0.5 truncate text-slate-500">{c.courses.join(" / ")}</p>
                      </div>
                      {editing !== c.classroom && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setEditing(c.classroom);
                            setRoomId(manual ?? "");
                            setMessage(null);
                          }}
                          className="shrink-0 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-slate-700 dark:text-slate-300 disabled:opacity-50"
                        >
                          {room ? "変更" : "入力"}
                        </button>
                      )}
                    </div>

                    {editing === c.classroom && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <input
                          value={roomId}
                          onChange={(ev) => setRoomId(ev.target.value)}
                          placeholder={c.derivedRoomId ? `教室番号 (空なら ${c.derivedRoomId})` : "教室番号 (例 614)"}
                          maxLength={32}
                          disabled={pending}
                          className={`${inputClass} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => void saveRoom(c.classroom, roomId)}
                          disabled={pending}
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
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {message && (
        <p className={`mt-2 ${message.error ? "text-rose-500" : "text-sky-500"}`}>{message.text}</p>
      )}
    </div>
  );
}
