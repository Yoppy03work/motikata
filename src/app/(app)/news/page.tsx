import { prisma } from "@/lib/db";
import { NewsList, type NewsRow } from "./NewsList";

export const dynamic = "force-dynamic";

// manaba のコースニュース一覧。未読を上に、新しい順。本文は manaba で読む。
export default async function NewsPage() {
  const rows = await prisma.manabaNews.findMany({
    orderBy: [{ publishedAt: "desc" }],
    take: 100,
  });
  const taskIds = await prisma.taskInstance.findMany({
    where: { source: "MANUAL", sourceExternalId: { in: rows.map((r) => `manaba-news:${r.id}`) } },
    select: { sourceExternalId: true },
  });
  const withTask = new Set(taskIds.map((t) => Number(t.sourceExternalId!.split(":")[1])));
  const items: NewsRow[] = rows.map((r) => ({
    id: r.id,
    courseName: r.courseName,
    title: r.title,
    author: r.author,
    publishedAt: r.publishedAt.toISOString(),
    url: r.url,
    read: r.readAt !== null,
    hasTask: withTask.has(r.id),
  }));
  return <NewsList initial={items} />;
}
