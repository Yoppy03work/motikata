"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PREF_SWIPE_NAV, readBoolPref } from "@/lib/prefs";

// 横スワイプで前日/翌日に移動 + ページ切替アニメーション。
// - pointerdown は root、pointermove / pointerup は window に付ける(子要素の
//   ボタン等をまたいでも取りこぼさない)
// - 指追従: ドラッグ中は内部要素を translateX で動かす
// - コミット時: 端まで滑らせ、router.push、新ページは反対側からスライドイン
// - 設定 OFF のときは DOM に触らない / 既定 OFF
// - data-swipe-ignore を持つ祖先上で始まったジェスチャーは無視

const COMMIT_DISTANCE = 60;
const LOCK_THRESHOLD = 10;
const ANIM_MS = 220;
const SLIDE_KEY = "mochikata:today-slide-from";

type SlideFrom = "left" | "right";

export function SwipeNav({
  todayYmd,
  prevYmd,
  nextYmd,
  children,
}: {
  todayYmd: string;
  prevYmd: string;
  nextYmd: string;
  children: React.ReactNode;
}) {
  const [enabled, setEnabled] = useState(false);
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setEnabled(readBoolPref(PREF_SWIPE_NAV, false));
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREF_SWIPE_NAV) setEnabled(readBoolPref(PREF_SWIPE_NAV, false));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ポインタ操作 + コミット時の slide-out
  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let locked: "x" | "y" | null = null;
    let animating = false;

    const setTransform = (x: number, animated: boolean) => {
      inner.style.transition = animated ? `transform ${ANIM_MS}ms ease-out` : "none";
      inner.style.transform = `translateX(${x}px)`;
    };

    const clearTransform = () => {
      inner.style.transition = "";
      inner.style.transform = "";
    };

    const reset = () => {
      pointerId = null;
      locked = null;
    };

    // 実マウスは弾く(誤発火防止)。ただし DevTools タッチエミュは
    // pointerType="mouse" のことがあるので、maxTouchPoints>0 ならタッチ扱いで通す。
    const hasTouch =
      typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;

    const onDown = (e: PointerEvent) => {
      if (animating || pointerId !== null) return;
      if (e.pointerType === "mouse" && !hasTouch) return;
      if (e.target instanceof Element && e.target.closest("[data-swipe-ignore]")) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      locked = null;
    };

    const onMove = (e: PointerEvent) => {
      if (pointerId === null || pointerId !== e.pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (locked === null) {
        if (Math.abs(dx) < LOCK_THRESHOLD && Math.abs(dy) < LOCK_THRESHOLD) return;
        locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (locked === "x") {
        setTransform(dx, false);
      }
    };

    const commit = (ymd: string, direction: 1 | -1) => {
      animating = true;
      const w = window.innerWidth;
      // 現在ページを direction の方向へ滑らせる
      setTransform(direction * w, true);
      // 新ページは「反対側」から入ってくる
      const slideFrom: SlideFrom = direction === -1 ? "right" : "left";
      try {
        window.sessionStorage.setItem(SLIDE_KEY, slideFrom);
      } catch {
        /* noop: private mode 等 */
      }
      window.setTimeout(() => {
        const q = ymd === todayYmd ? "" : `?date=${ymd}`;
        router.push(`/today${q}`);
      }, ANIM_MS);
    };

    const onUp = (e: PointerEvent) => {
      if (pointerId === null || pointerId !== e.pointerId) return;
      const dx = e.clientX - startX;
      const wasX = locked === "x";
      reset();
      if (!wasX) return;

      if (dx <= -COMMIT_DISTANCE) {
        commit(nextYmd, -1);
      } else if (dx >= COMMIT_DISTANCE) {
        commit(prevYmd, 1);
      } else {
        // 閾値未満: 元に戻すアニメ
        setTransform(0, true);
        window.setTimeout(clearTransform, ANIM_MS);
      }
    };

    root.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      root.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      clearTransform();
    };
  }, [enabled, prevYmd, nextYmd, todayYmd, router]);

  // viewYmd 変化(=新しいページが描画された)時に slide-in を再生
  useEffect(() => {
    if (!enabled) return;
    const inner = innerRef.current;
    if (!inner) return;
    let slideFrom: string | null = null;
    try {
      slideFrom = window.sessionStorage.getItem(SLIDE_KEY);
      if (slideFrom) window.sessionStorage.removeItem(SLIDE_KEY);
    } catch {
      /* noop */
    }
    if (slideFrom !== "left" && slideFrom !== "right") return;
    const w = window.innerWidth;
    const startX = slideFrom === "left" ? -w : w;

    inner.style.transition = "none";
    inner.style.transform = `translateX(${startX}px)`;
    // reflow を強制してから次フレームでアニメ再生
    void inner.getBoundingClientRect();
    requestAnimationFrame(() => {
      inner.style.transition = `transform ${ANIM_MS}ms ease-out`;
      inner.style.transform = "translateX(0)";
      window.setTimeout(() => {
        inner.style.transition = "";
        inner.style.transform = "";
      }, ANIM_MS);
    });
  }, [enabled, prevYmd, nextYmd, todayYmd]);

  return (
    <div
      ref={rootRef}
      // 設定 ON のときは画面全体(BottomNav 分を除く)を覆って、
      // タスクが少なくて空白の領域でもスワイプを拾えるようにする
      className={enabled ? "min-h-[calc(100dvh-6rem)]" : undefined}
      style={
        enabled
          ? { touchAction: "pan-y", userSelect: "none", overflowX: "hidden" }
          : undefined
      }
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
