import { requireAuthOrRedirect } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";
import { AddFab } from "@/components/AddFab";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // すべての (app)/* ページで実認証(iron-session復号)を実行
  await requireAuthOrRedirect();
  return (
    <div className="min-h-dvh pb-24">
      <div className="mx-auto max-w-md">{children}</div>
      <AddFab />
      <BottomNav />
    </div>
  );
}
