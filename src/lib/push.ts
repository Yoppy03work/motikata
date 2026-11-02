// Web Push ヘルパー。
// VAPID 鍵を web-push にセットして、保存済み PushSubscription に向けて送信する。
// 410 (Gone) / 404 が返ったら DB から自動削除。

import webpush from "web-push";
import { prisma } from "@/lib/db";
import { isAllowedPushEndpoint } from "@/lib/pushEndpoint";
import { decryptNotifySecret, encryptNotifySecret } from "@/lib/notifyCrypto";

// VAPID 鍵: .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) があればそれを使い、
// 無ければ初回に自動生成して Setting に保存する(秘密鍵は暗号化)。
// 利用者が .env を触らなくても設定画面の「通知を有効にする」だけで使えるようにするため。
const VAPID_SETTING_KEY = "vapid_keys";

type VapidKeys = { publicKey: string; privateKey: string };

let cached: VapidKeys | null = null;

async function loadVapidKeys(): Promise<VapidKeys> {
  if (cached) return cached;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    cached = { publicKey: pub, privateKey: priv };
    return cached;
  }
  const read = async () => {
    const row = await prisma.setting.findUnique({ where: { key: VAPID_SETTING_KEY } });
    const v = row?.value as { publicKey?: string; privateKeyEnc?: string } | undefined;
    if (!v?.publicKey || !v.privateKeyEnc) return null;
    return { publicKey: v.publicKey, privateKey: decryptNotifySecret(v.privateKeyEnc) };
  };
  let keys = await read();
  if (!keys) {
    const gen = webpush.generateVAPIDKeys();
    try {
      await prisma.setting.create({
        data: {
          key: VAPID_SETTING_KEY,
          value: { publicKey: gen.publicKey, privateKeyEnc: encryptNotifySecret(gen.privateKey) },
        },
      });
      keys = gen;
    } catch {
      // 並行リクエストが先に作った場合はそちらを使う
      keys = await read();
      if (!keys) throw new Error("VAPID 鍵を保存できませんでした");
    }
  }
  cached = keys;
  return keys;
}

async function configureIfNeeded(): Promise<boolean> {
  try {
    const keys = await loadVapidKeys();
    const subj = process.env.VAPID_SUBJECT || "mailto:noreply@example.com";
    webpush.setVapidDetails(subj, keys.publicKey, keys.privateKey);
    return true;
  } catch {
    return false;
  }
}

export async function getVapidPublicKey(): Promise<string> {
  return (await loadVapidKeys()).publicKey;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  // あると Service Worker が「完了」「30 分後」ボタンを付ける
  taskId?: number;
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
  if (!(await configureIfNeeded())) {
    throw new Error("VAPID 鍵を用意できませんでした");
  }
  const subs = await prisma.pushSubscription.findMany();
  // PUSH_HIDE_PAYLOAD=true のときはペイロードを送らず、SW 側で汎用通知にする運用も可
  const hide = process.env.PUSH_HIDE_PAYLOAD === "true";
  const body = hide ? null : JSON.stringify(payload);

  let delivered = 0;
  let removed = 0;
  let failed = 0;

  for (const s of subs) {
    // 検査導入前に保存された不正な endpoint には送らず、掃除する
    if (!isAllowedPushEndpoint(s.endpoint)) {
      await prisma.pushSubscription.delete({ where: { endpoint: s.endpoint } }).catch(() => {});
      removed++;
      continue;
    }
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
