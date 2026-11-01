// 通知の送信先をまとめて扱う。
//   - 外部通知先(Slack / Discord / LINE)は利用者が設定画面で登録し、NotifyChannel に暗号化保存
//   - ブラウザ通知(PUSH)は PushSubscription があれば有効
//   - Slack だけは従来の .env SLACK_WEBHOOK_URL も後方互換で使う(画面での登録が優先)

import { prisma } from "@/lib/db";
import { decryptNotifySecret, encryptNotifySecret } from "@/lib/notifyCrypto";
import {
  EXTERNAL_KINDS,
  parseNotifyConfig,
  summarizeConfig,
  toPlainText,
  type ExternalKind,
  type NotifyConfig,
  type NotifyMessage,
} from "@/lib/notifyConfig";
import { isPushConfigured, sendPushToAll } from "@/lib/push";

export type NotifyKind = ExternalKind | "PUSH";

export function isExternalKind(v: string): v is ExternalKind {
  return (EXTERNAL_KINDS as readonly string[]).includes(v);
}

type StoredChannel<K extends ExternalKind = ExternalKind> = {
  kind: K;
  enabled: boolean;
  config: NotifyConfig[K];
  lastError: string | null;
  fromEnv: boolean;
};

async function readChannel<K extends ExternalKind>(kind: K): Promise<StoredChannel<K> | null> {
  const row = await prisma.notifyChannel.findUnique({ where: { kind } });
  if (row) {
    let raw: unknown;
    try {
      raw = JSON.parse(decryptNotifySecret(row.configEnc));
    } catch {
      // 鍵を変えた等で復号できない。再登録してもらう
      return null;
    }
    const parsed = parseNotifyConfig(kind, raw);
    if (!parsed.ok) return null;
    return { kind, enabled: row.enabled, config: parsed.config, lastError: row.lastError, fromEnv: false };
  }
  if (kind === "SLACK" && process.env.SLACK_WEBHOOK_URL) {
    return {
      kind,
      enabled: true,
      config: { webhookUrl: process.env.SLACK_WEBHOOK_URL } as NotifyConfig[K],
      lastError: null,
      fromEnv: true,
    };
  }
  return null;
}

export async function saveChannel<K extends ExternalKind>(
  kind: K,
  config: NotifyConfig[K],
  enabled = true,
): Promise<void> {
  const configEnc = encryptNotifySecret(JSON.stringify(config));
  await prisma.notifyChannel.upsert({
    where: { kind },
    create: { kind, enabled, configEnc },
    update: { enabled, configEnc, lastError: null },
  });
}

export async function setChannelEnabled(kind: ExternalKind, enabled: boolean): Promise<boolean> {
  const res = await prisma.notifyChannel.updateMany({ where: { kind }, data: { enabled } });
  return res.count > 0;
}

export async function deleteChannel(kind: ExternalKind): Promise<void> {
  await prisma.notifyChannel.deleteMany({ where: { kind } });
}

export type ChannelStatus = {
  kind: NotifyKind;
  configured: boolean;
  enabled: boolean;
  summary: string | null;
  lastError: string | null;
  fromEnv?: boolean;
  subscriptions?: number;
};

// 設定画面用の一覧。秘密情報は summary にしか出さない。
export async function listChannelStatus(): Promise<ChannelStatus[]> {
  const out: ChannelStatus[] = [];
  const subscriptions = await prisma.pushSubscription.count();
  out.push({
    kind: "PUSH",
    configured: subscriptions > 0,
    enabled: subscriptions > 0,
    summary: subscriptions > 0 ? `${subscriptions} 台のブラウザ` : null,
    lastError: null,
    subscriptions,
  });
  for (const kind of EXTERNAL_KINDS) {
    const ch = await readChannel(kind);
    out.push({
      kind,
      configured: !!ch,
      enabled: !!ch?.enabled,
      summary: ch ? summarizeConfig(kind, ch.config) : null,
      lastError: ch?.lastError ?? null,
      fromEnv: ch?.fromEnv,
    });
  }
  return out;
}

// 「すべて」宛ての通知で実際に送る先。ON かつ登録済みのものだけ。
export async function enabledKinds(): Promise<NotifyKind[]> {
  const kinds: NotifyKind[] = [];
  if ((await prisma.pushSubscription.count()) > 0) kinds.push("PUSH");
  for (const kind of EXTERNAL_KINDS) {
    const ch = await readChannel(kind);
    if (ch?.enabled) kinds.push(kind);
  }
  return kinds;
}

export class NotifyNotConfigured extends Error {
  constructor(kind: NotifyKind) {
    super(`${kind} の通知先が未設定です`);
    this.name = "NotifyNotConfigured";
  }
}

const TIMEOUT_MS = 10_000;

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      // 登録時に公式ホストへ限定しているので、リダイレクトで別ホストへ飛ばさない
      redirect: "error",
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 1 つの通知先へ送る。失敗は例外。
 * 送り先が未設定 / OFF なら NotifyNotConfigured(ignoreDisabled はテスト送信用)。
 */
export async function sendVia(
  kind: NotifyKind,
  msg: NotifyMessage,
  opts: { ignoreDisabled?: boolean } = {},
): Promise<void> {
  if (kind === "PUSH") {
    if (!(await isPushConfigured())) throw new NotifyNotConfigured(kind);
    const result = await sendPushToAll({
      title: msg.title,
      body: msg.body,
      url: msg.url ?? "/today",
      tag: msg.tag,
    });
    if (result.total === 0) throw new NotifyNotConfigured(kind);
    if (result.delivered === 0) throw new Error(`push delivery failed (failed=${result.failed})`);
    return;
  }
  const ch = await readChannel(kind);
  if (!ch || (!ch.enabled && !opts.ignoreDisabled)) throw new NotifyNotConfigured(kind);
  const text = toPlainText(msg);
  try {
    if (kind === "SLACK") {
      await postJson((ch.config as NotifyConfig["SLACK"]).webhookUrl, { text });
    } else if (kind === "DISCORD") {
      await postJson((ch.config as NotifyConfig["DISCORD"]).webhookUrl, {
        content: text.slice(0, 2000),
        // タイトルに @everyone 等が入っていてもメンションにしない
        allowed_mentions: { parse: [] },
      });
    } else {
      const c = ch.config as NotifyConfig["LINE"];
      await postJson(
        "https://api.line.me/v2/bot/message/push",
        { to: c.userId, messages: [{ type: "text", text: text.slice(0, 5000) }] },
        { Authorization: `Bearer ${c.channelAccessToken}` },
      );
    }
    if (ch.lastError && !ch.fromEnv) {
      await prisma.notifyChannel.updateMany({ where: { kind }, data: { lastError: null } });
    }
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    if (!ch.fromEnv) {
      await prisma.notifyChannel.updateMany({ where: { kind }, data: { lastError: message } });
    }
    throw new Error(`${kind}: ${message}`);
  }
}

export type DeliverResult =
  | { kind: "sent"; partialError: string | null }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string };

/**
 * Reminder.channel に従って送る。ALL なら ON の通知先すべて。
 * 1 か所でも届けば sent(残りの失敗は partialError に残す)。
 */
export async function deliver(channel: NotifyKind | "ALL", msg: NotifyMessage): Promise<DeliverResult> {
  const kinds = channel === "ALL" ? await enabledKinds() : [channel];
  if (kinds.length === 0) return { kind: "skipped", reason: "通知先が設定されていません" };
  let delivered = 0;
  const errors: string[] = [];
  let notConfigured = 0;
  for (const k of kinds) {
    try {
      await sendVia(k, msg);
      delivered++;
    } catch (e) {
      if (e instanceof NotifyNotConfigured) notConfigured++;
      else errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (delivered > 0) return { kind: "sent", partialError: errors.length ? errors.join(" / ").slice(0, 500) : null };
  if (errors.length === 0 && notConfigured > 0) {
    return { kind: "skipped", reason: `${kinds.join(",")} の通知先が設定されていません` };
  }
  return { kind: "failed", error: errors.join(" / ").slice(0, 500) };
}
