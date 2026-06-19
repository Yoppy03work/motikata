// モチカタ Service Worker (Web Push 通知用、最小実装)。
// プッシュペイロード形式: { title, body, url? }
//   PUSH_HIDE_PAYLOAD=true のときは payload なしで届くので
//   汎用メッセージで通知する。

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = null;
  try {
    if (event.data) data = event.data.json();
  } catch {
    /* noop */
  }
  const title = (data && data.title) || "モチカタ";
  const body = (data && data.body) || "通知があります";
  const url = (data && data.url) || "/today";
  const tag = (data && data.tag) || "mochikata";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url },
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      requireInteraction: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/today";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes(url) && "focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return null;
    }),
  );
});
