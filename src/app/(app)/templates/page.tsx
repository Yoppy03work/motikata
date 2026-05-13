// 繰り返しテンプレート一覧 + 編集ページ。
// kind=RECURRING の TaskTemplate に対する CRUD。
// 毎日/毎週/毎月のプリセットから RRULE を組み立てる。

import { TemplatesClient } from "./TemplatesClient";

export const dynamic = "force-dynamic";

export default function TemplatesPage() {
  return (
    <main className="px-4 pt-6 pb-8">
      <h1 className="mb-1 text-2xl font-semibold">繰り返しテンプレート</h1>
      <p className="mb-4 text-xs text-slate-600 dark:text-slate-400">
        毎日・毎週・毎月の決まったタスクを登録しておくと、毎朝の cron で自動で TaskInstance に展開されます。
      </p>
      <TemplatesClient />
    </main>
  );
}
