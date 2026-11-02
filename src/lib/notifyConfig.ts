// 利用者が設定画面で登録する外部通知先の検証と保存形式。
// サーバ / テスト双方から使うので、DB や fetch には依存しない純粋関数だけを置く。

import { z } from "zod";

export const EXTERNAL_KINDS = ["SLACK", "DISCORD", "LINE"] as const;
export type ExternalKind = (typeof EXTERNAL_KINDS)[number];

export const NOTIFY_LABELS: Record<ExternalKind | "PUSH", string> = {
  PUSH: "ブラウザ通知",
  SLACK: "Slack",
  DISCORD: "Discord",
  LINE: "LINE",
};

// 送り先は各サービスの公式ホストに限定する(任意 URL への送信 = SSRF を防ぐ)。
const SlackConfig = z.object({
  webhookUrl: z
    .string()
    .trim()
    .max(300)
    .regex(/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/, "Slack の Incoming Webhook URL ではありません"),
});
const DiscordConfig = z.object({
  webhookUrl: z
    .string()
    .trim()
    .max(300)
    .regex(
      /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/,
      "Discord の Webhook URL ではありません",
    ),
});
const LineConfig = z.object({
  channelAccessToken: z.string().trim().min(20, "チャネルアクセストークンが短すぎます").max(1000),
  userId: z.string().trim().regex(/^U[0-9a-f]{32}$/, "LINE のユーザー ID は U から始まる 33 文字です"),
});

export type NotifyConfig = {
  SLACK: z.infer<typeof SlackConfig>;
  DISCORD: z.infer<typeof DiscordConfig>;
  LINE: z.infer<typeof LineConfig>;
};

const SCHEMAS = { SLACK: SlackConfig, DISCORD: DiscordConfig, LINE: LineConfig };

export function parseNotifyConfig<K extends ExternalKind>(
  kind: K,
  raw: unknown,
): { ok: true; config: NotifyConfig[K] } | { ok: false; error: string } {
  const r = SCHEMAS[kind].safeParse(raw);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "入力が不正です" };
  return { ok: true, config: r.data as NotifyConfig[K] };
}

// 画面に出す確認用の短い表示。秘密部分は出さない。
export function summarizeConfig(kind: ExternalKind, config: NotifyConfig[ExternalKind]): string {
  if (kind === "LINE") {
    const c = config as NotifyConfig["LINE"];
    return `ユーザー ${c.userId.slice(0, 5)}…${c.userId.slice(-4)}`;
  }
  const url = (config as NotifyConfig["SLACK"]).webhookUrl;
  return `${new URL(url).host}/…${url.slice(-4)}`;
}

// 通知 1 件の中身。チャネルごとの形式に変換して送る。
export type NotifyMessage = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  // ブラウザ通知に「完了」「30 分後」ボタンを付けるタスク(Slack 等の文面には使わない)
  taskId?: number;
};

export function toPlainText(msg: NotifyMessage): string {
  return msg.body ? `${msg.title}\n${msg.body}` : msg.title;
}
