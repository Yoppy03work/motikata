import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { parseId } from "@/lib/id";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = parseId(idStr);
  if (id === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  try {
    const updated = await prisma.taskInstance.update({
      where: { id },
      data: { status: "OPEN", completedAt: null },
    });
    return NextResponse.json({ instance: updated });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw e;
  }
}
