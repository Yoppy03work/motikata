// Web Push ヘルパー。
// VAPID 鍵を web-push にセットして、保存済み PushSubscription に向けて送信する。
// 410 (Gone) / 404 が返ったら DB から自動削除。

import webpush from "web-push";
import { prisma } from "@/lib/db";

let configured = false;
function configureIfNeeded(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || "mailto:noreply@example.com";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subj, pub, priv);
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export type PushSendResult = {
  total: number;
  delivered: number;
  removed: number; // 410 / 404 で消したサブスク数
  failed: number;
};

export async function isPushConfigured(): Promise<boolean> {
  return configureIfNeeded();
}

/** 保存されている全 PushSubscription にメッセージを送る。 */
export async function sendPushToAll(payload: PushPayload): Promise<PushSendResult> {
  if (!configureIfNeeded()) {
    throw new Error("VAPID keys not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)");
  }
  const subs = await prisma.pushSubscription.findMany();
  // PUSH_HIDE_PAYLOAD=true のときはペイロードを送らず、SW 側で汎用通知にする運用も可
  const hide = process.env.PUSH_HIDE_PAYLOAD === "true";
  const body = hide ? null : JSON.stringify(payload);

  let delivered = 0;
  let removed = 0;
  let failed = 0;

  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        body ?? undefined,
        { TTL: 60 * 60 * 24 },
      );
      delivered++;
    } catch (e: unknown) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription
          .delete({ where: { endpoint: s.endpoint } })
          .catch(() => {});
        removed++;
      } else {
        failed++;
      }
    }
  }
  return { total: subs.length, delivered, removed, failed };
}
