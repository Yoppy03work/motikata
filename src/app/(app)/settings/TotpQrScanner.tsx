"use client";

// TOTP登録QRをデバイスカメラで読み取るモーダル。
// html5-qrcode は内部で getUserMedia + Canvas で 1秒に数回フレームをデコード。
// 結果は onResult(decodedText) で返す(`otpauth://totp/...?secret=...&...` を想定)。
//
// SSRで window 参照を避けるため、親側で dynamic({ ssr: false }) でロード。
//
// セキュリティ:
//   - ストリームはローカル処理のみ。サーバー送信なし。
//   - スキャン成功 or アンマウントで stream を即座に停止。
//   - HTTPS or localhost が必要(ブラウザ仕様)。
//
// 防御:
//   - scanner.start() が失敗しても scannerRef を立てない(誤って stop を呼ばない)
//   - stop() は async/sync どちらで投げても全部呑み込む(クリーンアップ時に
//     例外が漏れると Next.js のエラーバウンダリが「Application error」を表示する)

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";

const READER_ID = "totp-qr-reader";

type Props = {
  onResult: (text: string) => void;
  onClose: () => void;
};

/** どんな例外パスでも握り潰してscanner.stop()を試みる。 */
function safeStop(scanner: Html5Qrcode | null): void {
  if (!scanner) return;
  try {
    const result = scanner.stop();
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    // sync throw も無視(start 前に stop した場合など)
  }
}

export function TotpQrScanner({ onResult, onClose }: Props) {
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
        scanner = new mod.Html5Qrcode(READER_ID, {
          verbose: false,
        });
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            // カメラの実描画領域に合わせてスキャン枠を可変にする。
            // 固定 240px だと縦横比がカメラと違うときに枠が外にはみ出すため。
            qrbox: (vw, vh) => {
              const m = Math.min(vw, vh);
              const s = Math.max(120, Math.floor(m * 0.7));
              return { width: s, height: s };
            },
            aspectRatio: 1.0,
          },
          (decodedText: string) => {
            // 二重発火ガード(複数フレームで同じQRが立て続けに刺さるため)
            if (!scannerRef.current) return;
            const s = scannerRef.current;
            scannerRef.current = null;
            try {
              const result = s.stop();
              if (result && typeof (result as Promise<void>).catch === "function") {
                (result as Promise<void>)
                  .catch(() => {})
                  .finally(() => onResult(decodedText));
                return;
              }
            } catch {
              // fallthrough
            }
            onResult(decodedText);
          },
          // フレームごとに発火する低レベルエラー(QR未検出など)はノーオペ
          () => {},
        );
        // start が成功した時だけ ref を立てる(失敗したら stop は呼ばない)
        if (cancelled) {
          // 競合: マウント直後に unmount された場合は即stop
          safeStop(scanner);
          return;
        }
        scannerRef.current = scanner;
        setRunning(true);
      } catch (e) {
        // start が失敗していても scanner インスタンスが残っていれば後始末
        safeStop(scanner);
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // 典型: "NotAllowedError" (権限拒否) / "NotFoundError" (カメラなし) /
        //       "NotReadableError" (他アプリで使用中)
        setError(
          /NotAllowed/i.test(msg)
            ? "カメラの使用が許可されていません。ブラウザのアドレスバー横の権限アイコンから許可してください。"
            : /NotFound/i.test(msg)
              ? "カメラが見つかりません。デバイスを確認してください。"
              : /NotReadable/i.test(msg)
                ? "カメラが他のアプリで使用中です。閉じてから再試行してください。"
                : /Insecure|HTTPS|secure context/i.test(msg)
                  ? "HTTPSまたはlocalhostでないとカメラを使えません。"
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
      aria-labelledby="totp-qr-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        // 背景クリックで閉じる(モーダル本体のクリックは伝播停止)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-4 shadow-lg">
        <h3
          id="totp-qr-title"
          className="text-sm font-semibold text-slate-800 dark:text-slate-100"
        >
          QRコードを読み取り
        </h3>
        <p className="mt-1 text-[11px] text-slate-500">
          カメラをポータルのMFA登録QRコードに向けてください。読み取り結果は端末内のみで処理され、シークレット欄に自動入力されます。
        </p>

        {/*
         * html5-qrcode は <video> をこの div の中に挿入する。
         * w-full で横幅を取り、aspect-square + object-cover で
         * 中の <video> を正方形領域いっぱいにクロップ表示する。
         * (内部 video の絶対寸法は html5-qrcode が決めるため、
         *  CSS 側で枠を制御してはみ出しを防ぐ)
         */}
        <div
          id={READER_ID}
          className="mt-3 aspect-square w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950 [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
        />

        {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
        {!error && !running && (
          <p className="mt-2 text-xs text-slate-500">カメラを起動中…</p>
        )}

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
