// クライアント側 UI プレファレンス(サーバー保存するほどでもないもの)。
// localStorage ベース。SSR 期は既定値を返し、hydration 後に再読込する。

export const PREF_SWIPE_NAV = "mochikata:swipe-nav";

export function readBoolPref(key: string, fallback = false): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "1";
}

export function writeBoolPref(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value ? "1" : "0");
}
