import type { Metadata, Viewport } from "next";
import "./globals.css";
import { themeInitScript } from "@/lib/theme";
import { ThemeWatcher } from "@/components/ThemeWatcher";

export const metadata: Metadata = {
  title: "モチカタ",
  description: "忘れ物防止リマインダー",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "モチカタ" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // ハイドレーション直前にテーマスクリプトが html に class="dark" を付けるので
    // サーバー HTML とクライアント DOM がズレる。html だけは警告抑止して問題ない
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/* FOUC 防止: 描画前にテーマを即適用 */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <ThemeWatcher />
        {children}
      </body>
    </html>
  );
}
