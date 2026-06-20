"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PREF_SWIPE_NAV, readBoolPref, writeBoolPref } from "@/lib/prefs";
import { applyTheme, readTheme, writeTheme, type ThemeMode } from "@/lib/theme";
import { RepeatIcon } from "@/components/icons";
import { AcademicImport } from "./AcademicImport";
import { CitPortalSettings } from "./CitPortalSettings";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { GoogleCalendarSettings } from "./GoogleCalendarSettings";
import { ManabaSettings } from "./ManabaSettings";
import { PushSettings } from "./PushSettings";
import { TagSettings } from "./TagSettings";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "自動" },
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
];

export default function SettingsPage() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [swipeNav, setSwipeNav] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("system");

  // localStorage は SSR 不可なのでマウント後に同期する
  useEffect(() => {
    setSwipeNav(readBoolPref(PREF_SWIPE_NAV, false));
    setTheme(readTheme());
  }, []);

  const toggleSwipeNav = () => {
    const next = !swipeNav;
    setSwipeNav(next);
    writeBoolPref(PREF_SWIPE_NAV, next);
  };

  const changeTheme = (mode: ThemeMode) => {
    setTheme(mode);
    writeTheme(mode);
    applyTheme(mode);
  };

  const logout = () => {
    startTransition(async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    });
  };

  return (
    <main className="px-4 pt-6 pb-8">
      <h1 className="mb-4 text-2xl font-semibold">設定</h1>

      <section className="space-y-4">
        <Link
          href="/templates"
          className="flex items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 transition hover:bg-sky-500/10 active:scale-[0.99]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-300">
            <RepeatIcon width={22} height={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
              繰り返しテンプレート
            </span>
            <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
              毎週・隔週などのタスクをテンプレ化して自動展開
            </span>
          </span>
          <span className="text-slate-400" aria-hidden>
            ›
          </span>
        </Link>

        <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">表示</h2>

          {/* テーマ切替 */}
          <div className="mb-4">
            <p className="mb-2 text-xs text-slate-500">テーマ</p>
            <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => changeTheme(opt.value)}
                  aria-pressed={theme === opt.value}
                  className={`rounded-md py-1.5 text-xs font-medium transition ${
                    theme === opt.value
                      ? "bg-sky-500 text-white"
                      : "text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 横スワイプ切替 */}
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="flex-1">
              <span className="block text-slate-800 dark:text-slate-200">
                横スワイプで日付を切り替え
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                今日ページで左右スワイプすると前日・翌日に移動します
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={swipeNav}
              onClick={toggleSwipeNav}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                swipeNav ? "bg-sky-500" : "bg-slate-300 dark:bg-slate-700"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                  swipeNav ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            アプリ通知 (Web Push)
          </h2>
          <PushSettings />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            ホーム画面に追加 (PWA)
          </h2>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            ブラウザではなく独立アプリとして起動できます。アドレスバーが消えて使い勝手が良くなります。
          </p>
          <PwaInstallPrompt />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            Slack 通知
          </h2>
          <p className="text-xs text-slate-500">
            <code>.env</code> の <code>SLACK_WEBHOOK_URL</code> を設定すると、
            タスクに登録したリマインダー(SLACK チャネル)が毎分の cron で配信されます。
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">学年歴</h2>
          <AcademicImport />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            manaba 連携
          </h2>
          <ManabaSettings />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            CITポータル 連携 (時間割)
          </h2>
          <CitPortalSettings />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            Google カレンダー 連携
          </h2>
          <GoogleCalendarSettings />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            タグ
          </h2>
          <TagSettings />
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            アカウント
          </h2>
          <button
            onClick={logout}
            disabled={pending}
            className="w-full rounded-lg border border-rose-500/40 bg-rose-500/10 py-2 text-sm text-rose-700 dark:text-rose-300 disabled:opacity-50"
          >
            ログアウト
          </button>
        </div>
      </section>
    </main>
  );
}
