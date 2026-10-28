import { NextResponse } from "next/server";
import { getSession, isSessionValid } from "./auth";

export async function requireAuthApi(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!(await isSessionValid(session))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
