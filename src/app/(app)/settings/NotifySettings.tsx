"use client";

// 通知先の設定。ブラウザ通知 / Slack / Discord / LINE を利用者が選んで登録する。
// 「通知先: すべて」のリマインダー(既定)は、ここで ON にしたもの全部に届く。
// 秘密情報(webhook URL / トークン)はサーバで暗号化保存し、画面には戻さない。

import { useCallback, useEffect, useState } from "react";
import { fetchJsonOrNull } from "@/lib/fetchJson";
import { PushSettings } from "./PushSettings";

type Kind = "PUSH" | "SLACK" | "DISCORD" | "LINE";

type ChannelStatus = {
  kind: Kind;
  configured: boolean;
  enabled: boolean;
  summary: string | null;
  lastError: string | null;
  fromEnv?: boolean;
};

type Field = { name: string; label: string; placeholder: string; secret?: boolean };

const EXTERNAL: {
  kind: Exclude<Kind, "PUSH">;
  label: string;
  fields: Field[];
  help: string[];
}[] = [
  {
    kind: "SLACK",
    label: "Slack",
    fields: [
      { name: "webhookUrl", label: "Webhook URL", placeholder: "https://hooks.slack.com/services/…", secret: true },
    ],
    help: [
      "Slack に「Incoming Webhooks」を追加し、通知したいチャンネルを選んで Webhook URL を発行します。",
    ],
  },
  {
    kind: "DISCORD",
    label: "Discord",
    fields: [
      { name: "webhookUrl", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/…", secret: true },
    ],
    help: [
      "サーバー設定 → 連携サービス → ウェブフック → 新しいウェブフック で、通知したいチャンネルを選んで「URL をコピー」します。",
    ],
  },
  {
    kind: "LINE",
    label: "LINE",
    fields: [
      { name: "channelAccessToken", label: "チャネルアクセストークン(長期)", placeholder: "", secret: true },
      { name: "userId", label: "あなたのユーザー ID", placeholder: "U から始まる 33 文字" },
    ],
    help: [
      "LINE 公式アカウントを作成し、Messaging API を有効にします(無料プランは月 200 通まで)。",
      "LINE Developers のチャネル画面で「チャネルアクセストークン(長期)」を発行し、「チャネル基本設定」の「あなたのユーザー ID」をコピーします。",
      "作った公式アカウントを、自分の LINE で友だち追加しておいてください。",
    ],
  },
];

const KIND_LABEL: Record<Kind, string> = {
  PUSH: "ブラウザ通知",
  SLACK: "Slack",
  DISCORD: "Discord",
  LINE: "LINE",
};

async function loadChannels() {
  const body = await fetchJsonOrNull<{ channels: ChannelStatus[] }>("/api/notify/channels");
  return body?.channels ?? null;
}

export function NotifySettings() {
  const [channels, setChannels] = useState<ChannelStatus[] | null>(null);
  const [editing, setEditing] = useState<Kind | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Kind | null>(null);
  const [message, setMessage] = useState<{ kind: Kind; text: string; error: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const list = await loadChannels();
    if (list) setChannels(list);
  }, []);

  useEffect(() => {
    let ignore = false;
    void loadChannels().then((list) => {
      if (!ignore && list) setChannels(list);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const statusOf = (kind: Kind) => channels?.find((c) => c.kind === kind);

  const request = async (kind: Kind, url: string, init: RequestInit, okText: string) => {
    setPending(kind);
    setMessage(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind, text: body.error ?? `失敗しました (${res.status})`, error: true });
        return false;
      }
      setMessage({ kind, text: okText, error: false });
      return true;
    } finally {
      setPending(null);
      await refresh();
    }
  };

  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const save = async (kind: Exclude<Kind, "PUSH">) => {
    const ok = await request(kind, `/api/notify/channels/${kind}`, json("PUT", { config: form, enabled: true }), "保存しました。テスト送信で届くか確認してください");
    if (ok) {
      setEditing(null);
      setForm({});
    }
  };

  const toggle = (kind: Exclude<Kind, "PUSH">, enabled: boolean) =>
    request(kind, `/api/notify/channels/${kind}`, json("PUT", { enabled }), enabled ? "ON にしました" : "OFF にしました");

  const remove = async (kind: Exclude<Kind, "PUSH">) => {
    if (!confirm(`${KIND_LABEL[kind]} の通知先を削除します。よろしいですか?`)) return;
    await request(kind, `/api/notify/channels/${kind}`, { method: "DELETE" }, "削除しました");
  };

  const test = (kind: Kind) =>
    request(kind, "/api/notify/test", json("POST", { kind }), "テスト通知を送りました");

  const startEdit = (kind: Kind) => {
    setEditing(kind);
    setForm({});
    setMessage(null);
  };

  const enabledLabels = (channels ?? []).filter((c) => c.enabled).map((c) => KIND_LABEL[c.kind]);

  const btn =
    "rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 disabled:opacity-50";
  const card =
    "rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 text-xs";

  const feedback = (kind: Kind) =>
    message?.kind === kind && (
      <p className={`mt-2 ${message.error ? "text-rose-500" : "text-sky-500"}`}>{message.text}</p>
    );

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        リマインダーを受け取る場所を選びます。通知先「すべて」のリマインダー(既定)と、manaba
        の締切前の未提出通知(時刻は「manaba 連携」で設定)は、ON にした通知先すべてに届きます。
      </p>
      {channels && (
        <p className="text-xs text-slate-700 dark:text-slate-300">
          現在の通知先:{" "}
          {enabledLabels.length > 0 ? (
            enabledLabels.join("・")
          ) : (
            <span className="text-amber-600 dark:text-amber-400">未設定(通知は届きません)</span>
          )}
        </p>
      )}

      <div className={card}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-200">ブラウザ通知</span>
          {statusOf("PUSH")?.enabled && (
            <button type="button" onClick={() => void test("PUSH")} disabled={pending !== null} className={btn}>
              テスト送信
            </button>
          )}
        </div>
        <p className="mb-2 text-slate-500">
          このアプリを開いているブラウザに通知します。Mac で localhost を開いている場合、届くのはその Mac だけです。
        </p>
        <PushSettings onChange={() => void refresh()} />
        {statusOf("PUSH")?.summary && <p className="mt-1 text-slate-500">登録済み: {statusOf("PUSH")!.summary}</p>}
        {feedback("PUSH")}
      </div>

      {EXTERNAL.map((ch) => {
        const st = statusOf(ch.kind);
        const isEditing = editing === ch.kind;
        return (
          <div key={ch.kind} className={card}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{ch.label}</span>
              {st?.configured && !st.fromEnv && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={st.enabled}
                  aria-label={`${ch.label} に通知する`}
                  onClick={() => void toggle(ch.kind, !st.enabled)}
                  disabled={pending !== null}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
                    st.enabled ? "bg-sky-500" : "bg-slate-300 dark:bg-slate-700"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                      st.enabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              )}
            </div>

            {st?.configured && !isEditing && (
              <>
                <p className="mt-1 text-slate-500">
                  送り先: {st.summary}
                  {st.fromEnv && "(.env の設定。画面から登録すると置き換わります)"}
                </p>
                {st.lastError && <p className="mt-1 text-[11px] text-rose-500">直近エラー: {st.lastError}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => void test(ch.kind)} disabled={pending !== null} className={btn}>
                    {pending === ch.kind ? "送信中..." : "テスト送信"}
                  </button>
                  <button type="button" onClick={() => startEdit(ch.kind)} disabled={pending !== null} className={btn}>
                    {st.fromEnv ? "画面から登録" : "変更"}
                  </button>
                  {!st.fromEnv && (
                    <button
                      type="button"
                      onClick={() => void remove(ch.kind)}
                      disabled={pending !== null}
                      className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-xs text-rose-600 dark:text-rose-300 disabled:opacity-50"
                    >
                      削除
                    </button>
                  )}
                </div>
              </>
            )}

            {st && !st.configured && !isEditing && (
              <button type="button" onClick={() => startEdit(ch.kind)} className={`mt-2 ${btn}`}>
                登録する
              </button>
            )}

            {isEditing && (
              <div className="mt-2 space-y-2">
                <ul className="list-disc space-y-0.5 pl-4 text-slate-500">
                  {ch.help.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
                {ch.fields.map((f) => (
                  <label key={f.name} className="block">
                    <span className="block text-slate-600 dark:text-slate-400">{f.label}</span>
                    <input
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      value={form[f.name] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.name]: e.target.value }))}
                      disabled={pending !== null}
                      className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-hidden focus:ring-2 focus:ring-sky-500"
                    />
                  </label>
                ))}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void save(ch.kind)}
                    disabled={pending !== null || ch.fields.some((f) => !form[f.name]?.trim())}
                    className="flex-1 rounded-md bg-sky-500 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {pending === ch.kind ? "保存中..." : "保存"}
                  </button>
                  <button type="button" onClick={() => setEditing(null)} disabled={pending !== null} className={btn}>
                    やめる
                  </button>
                </div>
              </div>
            )}
            {feedback(ch.kind)}
          </div>
        );
      })}
    </div>
  );
}
