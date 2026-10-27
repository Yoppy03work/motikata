// PushSubscription.endpoint の検査。
// endpoint はブラウザが払い出すプッシュサービスの URL だが、API には任意の文字列を送れる。
// 無検査だとリマインダー配信のたびにサーバが任意の URL (社内ネットワークや
// 169.254.169.254 など) へ POST する SSRF になるので、既知のプッシュサービスに限定する。

// ホスト名の完全一致、または "." 始まりはそのサブドメインを許可する。
const ALLOWED_HOSTS = [
  "fcm.googleapis.com", // Chrome / Edge(Chromium) / Android / Samsung Internet
  "android.googleapis.com", // 旧 GCM 形式
  ".push.apple.com", // Safari / iOS (web.push.apple.com)
  ".notify.windows.com", // 旧 Edge / Windows
  ".push.services.mozilla.com", // Firefox (updates.push.services.mozilla.com)
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port !== "") return false;
  const host = u.hostname;
  return ALLOWED_HOSTS.some((a) => (a.startsWith(".") ? host.endsWith(a) : host === a));
}
