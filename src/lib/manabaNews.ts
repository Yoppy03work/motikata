// manaba のコースニュースの取り込みと新着通知。
//   - manaba 同期(runManabaSync)の最後に、同じログインで呼ぶ
//   - コース一覧で「未読のニュースがあります」のアイコンが付いたコースだけ、ニュース一覧を読む
//     (アイコンが読めないときは全コースを読む)
//   - 初めて見たニュースを ManabaNews に入れ、manaba で未読かつ公開から NOTIFY_WITHIN_MS 以内のものを通知する
//   - manaba 側で既読になったニュースは、アプリでも既読にする

import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { deliver } from "@/lib/notify";
import type { NotifyMessage } from "@/lib/notifyConfig";
import {
  parseCourseList,
  parseNewsList,
  type ManabaNewsItem,
  type ManabaSession,
} from "@/lib/manabaScrape";
import { APP_TZ } from "@/lib/tz";

// 取り込み初回や、長く止まっていたあとに昔のニュースをまとめて通知しないため
const NOTIFY_WITHIN_MS = 3 * 24 * 60 * 60_000;
// 1 回の同期で開くニュース一覧の上限(異常時の大量アクセス防止)
const MAX_COURSES = 30;
const MAX_LINES = 8;

export type NewNews = Pick<ManabaNewsItem, "title" | "author" | "publishedAt"> & { courseName: string };

export function buildNewsMessage(items: NewNews[]): NotifyMessage | null {
  if (items.length === 0) return null;
  const when = (d: Date) => formatInTimeZone(d, APP_TZ, "M/d HH:mm");
  if (items.length === 1) {
    const n = items[0];
    return {
      title: `【${n.courseName}】${n.title}`.slice(0, 120),
      body: `manaba のコースニュース(${[n.author, when(n.publishedAt)].filter(Boolean).join("・")})`,
      url: "/news",
      tag: "manaba-news",
    };
  }
  const sorted = [...items].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  const lines = sorted.slice(0, MAX_LINES).map((n) => `・【${n.courseName}】${n.title}`);
  if (sorted.length > MAX_LINES) lines.push(`ほか ${sorted.length - MAX_LINES} 件`);
  return {
    title: `manaba のコースニュースが ${items.length} 件あります`,
    body: lines.join("\n"),
    url: "/news",
    tag: "manaba-news",
  };
}

export type NewsSyncResult = { courses: number; found: number; inserted: number; notified: number };

export async function syncManabaNews(session: ManabaSession, now = new Date()): Promise<NewsSyncResult> {
  const listRes = await session.fetch(`${session.base}/ct/home_course`);
  if (!listRes.ok) throw new Error(`コース一覧の取得に失敗 (HTTP ${listRes.status})`);
  const courses = parseCourseList(await listRes.text());
  const iconsKnown = courses.some((c) => c.hasUnreadNews !== null);
  const targets = courses.filter((c) => !iconsKnown || c.hasUnreadNews).slice(0, MAX_COURSES);

  const found: (ManabaNewsItem & { courseName: string })[] = [];
  for (const c of targets) {
    const res = await session.fetch(`${session.base}/ct/course_${c.courseId}_news`);
    if (!res.ok) continue;
    for (const item of parseNewsList(await res.text(), session.base, c.courseId)) {
      found.push({ ...item, courseName: c.name });
    }
  }

  let inserted = 0;
  const fresh: NewNews[] = [];
  const freshIds: number[] = [];
  for (const n of found) {
    const existing = await prisma.manabaNews.findUnique({ where: { id: n.newsId }, select: { readAt: true } });
    if (existing) {
      // manaba で読んだものはアプリでも既読にする(逆に manaba の未読でアプリの既読は戻さない)
      if (!n.unread && !existing.readAt) {
        await prisma.manabaNews.update({ where: { id: n.newsId }, data: { readAt: now } });
      }
      continue;
    }
    const notify = n.unread && now.getTime() - n.publishedAt.getTime() <= NOTIFY_WITHIN_MS;
    const created = await prisma.manabaNews.createMany({
      data: [
        {
          id: n.newsId,
          courseId: n.courseId,
          courseName: n.courseName,
          title: n.title,
          author: n.author,
          publishedAt: n.publishedAt,
          url: n.url,
          readAt: n.unread ? null : now,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) continue;
    inserted++;
    if (notify) {
      fresh.push(n);
      freshIds.push(n.newsId);
    }
  }

  let notified = 0;
  const msg = buildNewsMessage(fresh);
  if (msg) {
    const result = await deliver("ALL", msg);
    if (result.kind === "sent") {
      await prisma.manabaNews.updateMany({ where: { id: { in: freshIds } }, data: { notifiedAt: new Date() } });
      notified = freshIds.length;
    }
  }
  return { courses: targets.length, found: found.length, inserted, notified };
}
