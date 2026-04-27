import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { NoteCreateInput, NoteListQuery } from "@/lib/validation/memo";

export async function GET(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const url = new URL(req.url);
  const parsed = NoteListQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid query" }, { status: 400 });
  const { tab, date, includeArchived } = parsed.data;

  let where: Record<string, unknown> = {};
  if (tab === "inbox") {
    where = { kind: "INBOX", ...(includeArchived ? {} : { archivedAt: null }) };
  } else if (tab === "diary") {
    where = {
      kind: "DIARY",
      ...(date
        ? {
            diaryDate: {
              gte: new Date(date + "T00:00:00+09:00"),
              lt: new Date(date + "T23:59:59.999+09:00"),
            },
          }
        : {}),
    };
  }

  const notes = await prisma.note.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ notes });
}

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const body = await req.json().catch(() => null);
  const parsed = NoteCreateInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data: {
    body: string;
    kind: "INBOX" | "DIARY";
    diaryDate?: Date;
  } = {
    body: parsed.data.body,
    kind: parsed.data.kind,
  };
  if (parsed.data.kind === "DIARY") {
    const d = parsed.data.diaryDate ?? new Date().toISOString().slice(0, 10);
    data.diaryDate = new Date(d + "T00:00:00+09:00");
  }

  const note = await prisma.note.create({ data });
  return NextResponse.json({ note }, { status: 201 });
}
