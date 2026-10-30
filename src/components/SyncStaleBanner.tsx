import Link from "next/link";
import { prisma } from "@/lib/db";
import { isSyncStale } from "@/lib/syncStaleness";

// 自動同期が 12 時間以上成功していないときに全ページ上部へ出す警告。
// 2026-10 に worker が止まって 2 日近く manaba を取り込めず、
// どこにもエラーが出なかったので気づけなかった反省から。
export async function SyncStaleBanner() {
  let stale: string[] = [];
  try {
    const [m, c] = await Promise.all([
      prisma.manabaCredential.findFirst({ select: { lastSyncedAt: true } }),
      prisma.citPortalCredential.findFirst({ select: { lastSyncedAt: true } }),
    ]);
    stale = [
      m && isSyncStale(m.lastSyncedAt) ? "manaba" : null,
      c && isSyncStale(c.lastSyncedAt) ? "CIT ポータル" : null,
    ].filter((s): s is string => s !== null);
  } catch (e) {
    // 警告の取得失敗でページ全体を落とさない
    console.error("[sync-stale] check failed:", e instanceof Error ? e.message : e);
  }
  if (stale.length === 0) return null;

  return (
    <Link
      href="/settings"
      className="block border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      {stale.join("・")} の自動同期が 12 時間以上止まっています。設定から手動で同期してください。
    </Link>
  );
}
