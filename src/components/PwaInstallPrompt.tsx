"use client";

// PWA インストール促進 UI。
//
// 2 つのプラットフォームを区別して対応する:
// (1) Android Chrome / Edge: `beforeinstallprompt` イベントを listener で
//     拾い、native install dialog を呼べる。ユーザー操作 (button click) からだけ
//     prompt() できる仕様。
// (2) iOS Safari: beforeinstallprompt 非対応。Share → "ホーム画面に追加" の
//     手順を明示する必要がある。代わりに `navigator.standalone` プロパティで
//     既に install 済みか判定できる。
//
// 既に standalone (display-mode: standalone) で起動されているなら何も表示しない。

import { useEffect, useState } from "react";

// Chrome BeforeInstallPromptEvent (TypeScript lib 未収録の experimental DOM API)。
// prompt() を呼んでユーザーが install を承認すると userChoice が resolve する。
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
  // Chrome/Edge on iOS は Safari engine だが UA に CriOS/EdgiOS が入る。
  // それでも install path は Safari と同じなので isIos === true で扱う。
  return isIos;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari の standalone (legacy property)
    navigatorWithStandalone.standalone === true
  );
}

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }
    // Android Chrome / Edge
    const onPrompt = (e: Event) => {
      e.preventDefault(); // 自動表示を抑え、UI ボタンで promote
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) {
    return (
      <p className="text-xs text-slate-600 dark:text-slate-400">
        ✓ アプリとしてインストール済み
      </p>
    );
  }

  // Android: install event があれば 1 タップで実行
  if (installEvent) {
    return (
      <button
        type="button"
        onClick={async () => {
          await installEvent.prompt();
          const choice = await installEvent.userChoice;
          if (choice.outcome === "accepted") setInstalled(true);
          setInstallEvent(null);
        }}
        className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-700 dark:text-sky-300 active:scale-95"
      >
        ホーム画面に追加 (アプリとして起動)
      </button>
    );
  }

  // iOS Safari: 明示的な手順を案内 (beforeinstallprompt 非対応)
  if (isIosSafari()) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowIosGuide((v) => !v)}
          className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-700 dark:text-sky-300 active:scale-95"
        >
          ホーム画面に追加する方法 (iOS Safari)
        </button>
        {showIosGuide && (
          <ol className="list-inside list-decimal space-y-1 rounded-md border border-slate-200 bg-slate-100 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <li>下部の共有ボタン (□↑) をタップ</li>
            <li>「ホーム画面に追加」を選択</li>
            <li>右上の「追加」をタップ</li>
            <li>ホーム画面のアイコンから起動するとアプリ表示で動作します</li>
          </ol>
        )}
      </div>
    );
  }

  // それ以外 (デスクトップ Chrome 等で beforeinstallprompt 来てない、
  // または非対応ブラウザ) は何も出さない。
  return null;
}
