import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireAuthApi } from "@/lib/authGuard";

export async function POST() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}
