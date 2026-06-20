import { NextResponse, type NextRequest } from "next/server";
import { sessionOptions } from "@/lib/session";
import { isSameOrigin } from "@/lib/csrf";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/manifest.json",
  "/sw.js",
  // 監視 / uptime check 用。認証情報や個人データを返さないため public で問題なし。
  "/api/health",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 状態変更系 API は Origin/Referer が自サイトであることを必須にする(CSRF 防御)。
  // /api/jobs/* は内部 cron が JOBS_TOKEN 付きで叩くため除外(ブラウザ経由ではない)。
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/jobs/") &&
    !isSameOrigin(req)
  ) {
    return NextResponse.json({ error: "cross-site request rejected" }, { status: 403 });
  }

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/api/jobs/")
  ) {
    return NextResponse.next();
  }

  // セッションcookieの存在だけ確認。実際の改ざん検証は
  // API Route / ページ側の getSession() で行う(iron-sessionが復号する)
  const cookie = req.cookies.get(sessionOptions.cookieName);
  if (!cookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
