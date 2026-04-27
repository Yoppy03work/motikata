"use client";

import { useEffect } from "react";
import { applyTheme, readTheme, THEME_KEY } from "@/lib/theme";

// テーマ変更を反映するクライアント側ウォッチャー。
// - localStorage 変更(別タブからの切替)を監視
// - "system" のときは prefers-color-scheme の変更にも追従

export function ThemeWatcher() {
  useEffect(() => {
    applyTheme(readTheme());

    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) applyTheme(readTheme());
    };
    window.addEventListener("storage", onStorage);

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (readTheme() === "system") applyTheme("system");
    };
    mql.addEventListener("change", onSystem);

    return () => {
      window.removeEventListener("storage", onStorage);
      mql.removeEventListener("change", onSystem);
    };
  }, []);

  return null;
}
