"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarIcon,
  CheckCircleIcon,
  GearIcon,
  GridIcon,
  PencilIcon,
  SunIcon,
} from "./icons";
import type { FC, SVGProps } from "react";

type Item = {
  href: string;
  label: string;
  Icon: FC<SVGProps<SVGSVGElement>>;
};

const items: Item[] = [
  { href: "/today", label: "今日", Icon: SunIcon },
  { href: "/classes", label: "時間割", Icon: GridIcon },
  { href: "/calendar", label: "カレンダー", Icon: CalendarIcon },
  { href: "/tasks", label: "タスク", Icon: CheckCircleIcon },
  { href: "/memo", label: "メモ", Icon: PencilIcon },
  { href: "/settings", label: "設定", Icon: GearIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-md grid-cols-6">
        {items.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex flex-col items-center gap-1 py-2.5 text-[10px] ${
                  active ? "text-sky-400" : "text-slate-600 dark:text-slate-400"
                }`}
              >
                <Icon width={20} height={20} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
