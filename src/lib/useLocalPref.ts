import { useSyncExternalStore } from "react";
import { subscribeLocalPrefs } from "./localPrefStore";
import { readBoolPref } from "./prefs";
import { readTheme, type ThemeMode } from "./theme";

// localStorage の UI 設定を読むフック。SSR とハイドレーション中は既定値を返し、
// その後 localStorage の値に切り替わる(以前は useEffect で setState していた)。

export function useBoolPref(key: string, fallback = false): boolean {
  return useSyncExternalStore(
    subscribeLocalPrefs,
    () => readBoolPref(key, fallback),
    () => fallback,
  );
}

export function useThemePref(): ThemeMode {
  return useSyncExternalStore(subscribeLocalPrefs, readTheme, () => "system" as const);
}
