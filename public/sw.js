// モチカタ Service Worker (Web Push 通知用、最小実装)。
// プッシュペイロード形式: { title, body, url?, tag?, taskId? }
//   taskId があると「完了」「30 分後」ボタンを付け、押されたらアプリを開かずに API を叩く。
//   (ボタンは Chrome / Edge 等で表示される。Safari では出ないので、通知を押してアプリで操作する)
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
  const taskId = data && Number.isInteger(data.taskId) ? data.taskId : null;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url, taskId, title },
      actions: taskId
        ? [
            { action: "done", title: "完了" },
            { action: "snooze", title: "30 分後" },
          ]
        : [],
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      requireInteraction: false,
    }),
  );
});

// 「完了」「30 分後」ボタン。ログインが切れている等で失敗したらアプリを開く。
async function runAction(action, data) {
  const path =
    action === "done" ? `/api/tasks/${data.taskId}/complete` : `/api/tasks/${data.taskId}/snooze`;
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: action === "snooze" ? JSON.stringify({ minutes: 30 }) : "{}",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // 押したことが分かるように、同じ場所に静かな確認を出す
  await self.registration.showNotification(action === "done" ? "完了にしました" : "30 分後にもう一度知らせます", {
    body: data.title || "",
    tag: `action-${data.taskId}`,
    silent: true,
    data: { url: "/today" },
    icon: "/icons/icon-192.png",
  });
}

function openApp(url) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const c of clients) {
      if (c.url.includes(url) && "focus" in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
    return null;
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || "/today";
  if ((event.action === "done" || event.action === "snooze") && data.taskId) {
    event.waitUntil(runAction(event.action, data).catch(() => openApp(url)));
    return;
  }
  event.waitUntil(openApp(url));
});
