import { TimetableClient } from "./TimetableClient";

export const dynamic = "force-dynamic";

export default function ClassesPage() {
  return (
    <main className="px-4 pt-6 pb-8">
      <header className="mb-3">
        <h1 className="text-2xl font-semibold">時間割</h1>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
          各セルをタップして授業を追加・編集。教室は手入力(自動取得は今後対応予定)。
        </p>
      </header>
      <TimetableClient />
    </main>
  );
}
