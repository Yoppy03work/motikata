"use client";

// 出席 QR をデバイスカメラで読み取るモーダル。settings/TotpQrScanner.tsx と同じ
// html5-qrcode の使い方 (getUserMedia + Canvas デコード) を出席用コピーに。
//
// セキュリティ: ストリームはローカル処理のみ。スキャン成功 or アンマウントで stream 停止。
// HTTPS or localhost が必要 (ブラウザ仕様)。読み取った QR 文字列はサーバー側で検証する。

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";

const READER_ID = "attendance-qr-reader";

type Props = {
  onResult: (text: string) => void;
  onClose: () => void;
};

function safeStop(scanner: Html5Qrcode | null): void {
  if (!scanner) return;
  try {
    const result = scanner.stop();
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    // start 前の stop など sync throw は無視
  }
}

export function AttendanceQrScanner({ onResult, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      let scanner: Html5Qrcode | null = null;
      try {
        const mod = await import("html5-qrcode");
        if (cancelled) return;
        scanner = new mod.Html5Qrcode(READER_ID, { verbose: false });
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (vw, vh) => {
              const m = Math.min(vw, vh);
              const s = Math.max(120, Math.floor(m * 0.7));
              return { width: s, height: s };
            },
            aspectRatio: 1.0,
          },
          (decodedText: string) => {
            if (!scannerRef.current) return;
            const s = scannerRef.current;
            scannerRef.current = null;
            try {
              const result = s.stop();
              if (result && typeof (result as Promise<void>).catch === "function") {
                (result as Promise<void>).catch(() => {}).finally(() => onResult(decodedText));
                return;
              }
            } catch {
              // fallthrough
            }
            onResult(decodedText);
          },
          () => {},
        );
        if (cancelled) {
          safeStop(scanner);
          return;
        }
        scannerRef.current = scanner;
        setRunning(true);
      } catch (e) {
        safeStop(scanner);
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /NotAllowed/i.test(msg)
            ? "カメラの使用が許可されていません。ブラウザの権限を許可してください。"
            : /NotFound/i.test(msg)
              ? "カメラが見つかりません。"
              : /NotReadable/i.test(msg)
                ? "カメラが他アプリで使用中です。"
                : /Insecure|HTTPS|secure context/i.test(msg)
                  ? "HTTPS または localhost でないとカメラを使えません。"
                  : `カメラ起動失敗: ${msg.slice(0, 200)}`,
        );
      }
    };
    void start();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      safeStop(scanner);
    };
  }, [onResult]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="attendance-qr-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-4 shadow-lg">
        <h3 id="attendance-qr-title" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          出席 QR を読み取り
        </h3>
        <p className="mt-1 text-[11px] text-slate-500">
          教室に表示された出席 QR コードにカメラを向けてください。読み取り結果でそのまま出席を送信します。
        </p>

        <div
          id={READER_ID}
          className="mt-3 aspect-square w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950 [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
        />

        {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
        {!error && !running && <p className="mt-2 text-xs text-slate-500">カメラを起動中…</p>}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 text-sm text-slate-700 dark:text-slate-300"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
