"use client";

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const DEFAULT_NEXT = "/today";

// オープンリダイレクト防止。
// - 先頭が "/" で始まる
// - ただし "//" や "/\\" はプロトコル相対や Windows 相対として外部に飛ぶ可能性があるため禁止
// - コントロール文字を含むものも弾く
function sanitizeNext(raw: string | null): string {
  if (!raw) return DEFAULT_NEXT;
  if (raw.length > 512) return DEFAULT_NEXT;
  if (!raw.startsWith("/")) return DEFAULT_NEXT;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_NEXT;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_NEXT;
  return raw;
}

function LoginForm() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const params = useSearchParams();
  const next = sanitizeNext(params.get("next"));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        router.push(next);
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "ログインに失敗しました");
        setPin("");
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-xs space-y-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-6 shadow-xl"
    >
      <div>
        <h1 className="text-xl font-semibold">モチカタ</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">PINを入力</p>
      </div>
      <input
        type="password"
        inputMode="numeric"
        pattern="\d*"
        autoComplete="off"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        className="w-full rounded-xl bg-slate-200 dark:bg-slate-800 px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none focus:ring-2 focus:ring-sky-500"
        placeholder="••••"
        maxLength={8}
        autoFocus
      />
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <button
        type="submit"
        disabled={pending || pin.length < 4}
        className="w-full rounded-xl bg-sky-500 py-3 font-medium text-slate-950 disabled:opacity-50"
      >
        {pending ? "確認中..." : "ログイン"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
