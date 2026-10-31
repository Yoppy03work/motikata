// クライアント側 UI プレファレンス(サーバー保存するほどでもないもの)。
// localStorage ベース。コンポーネントからは useLocalPref.ts のフックで読む。

import { notifyLocalPrefChange } from "./localPrefStore";

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
  notifyLocalPrefChange();
}
