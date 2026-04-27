// テーマ管理(light / dark / system)。
// localStorage に保存し、html.dark クラスを切り替える。

export const THEME_KEY = "mochikata:theme";
export type ThemeMode = "light" | "dark" | "system";

export function readTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(THEME_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

export function writeTheme(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_KEY, mode);
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

// FOUC 防止用の同期初期化スクリプト。<head> に inline で挿入する。
// localStorage と prefers-color-scheme を見て html.dark を即座に付ける。
export const themeInitScript = `
(function(){try{
  var k='${THEME_KEY}';
  var v=localStorage.getItem(k);
  var dark = v === 'dark' || ((v===null||v==='system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if(dark) document.documentElement.classList.add('dark');
}catch(e){}})();
`.trim();
