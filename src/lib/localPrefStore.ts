// localStorage に置く UI 設定の変更通知。useSyncExternalStore の subscribe に使う。
// storage イベントは「他のタブ」での変更でしか飛ばないので、同じタブでの書き込みは
// notifyLocalPrefChange() で購読者に知らせる(prefs.ts / theme.ts の write* が呼ぶ)。

const listeners = new Set<() => void>();

export function subscribeLocalPrefs(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function notifyLocalPrefChange(): void {
  for (const l of listeners) l();
}
