export default function TasksPage() {
  return (
    <main className="px-4 pt-6 pb-8">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">タスク</h1>
        <button className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-950">
          + 追加
        </button>
      </header>
      <p className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-600 dark:text-slate-400">
        Phase 1 で実装予定(手動CRUD + 持ち物 + タグ/優先度)
      </p>
    </main>
  );
}
