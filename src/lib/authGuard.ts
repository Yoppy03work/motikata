import { NextResponse } from "next/server";
import { getSession } from "./auth";

export async function requireAuthApi(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session.authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
