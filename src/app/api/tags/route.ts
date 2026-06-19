// タグ管理 API。
// 単一ユーザー前提なので CRUD のみ。
// name は unique 制約あり、color は #RRGGBB の任意フィールド。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const HEX_COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/, "#RRGGBB 形式");

const CreateBody = z.object({
  name: z.string().min(1).max(40),
  color: HEX_COLOR.optional().nullable(),
});

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ ok: true, tags });
}

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const tag = await prisma.tag.create({
      data: {
        name: parsed.data.name.trim(),
        color: parsed.data.color ?? null,
      },
    });
    return NextResponse.json({ ok: true, tag }, { status: 201 });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "同じ名前のタグが既に存在します" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "作成失敗" }, { status: 500 });
  }
}
