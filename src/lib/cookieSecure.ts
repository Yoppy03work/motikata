// セッション系 Cookie の Secure フラグを決定する。
//
// 単一ソース: session.ts (iron-session) と login/route.ts (mochikata_anon_id)
// が同じロジックを共有するために切り出す。片方だけ条件を変えて
// 「セッションは Secure だが anon は Secure じゃない」ような差異が
// 生まれる事故 (SESSION_COOKIE_SECURE 導入の経緯はまさにこれの修復) を防ぐ。
//
// 優先順位:
//   1. SESSION_COOKIE_SECURE="true"  → true
//   2. SESSION_COOKIE_SECURE="false" → false
//   3. 未指定 → NODE_ENV === "production" のとき true、それ以外 false
//
// 値は process.env から読むので、Next.js standalone server (next start) では
// 起動時に一度だけ解決される(モジュール初期化時)。
export function resolveCookieSecure(): boolean {
  const v = process.env.SESSION_COOKIE_SECURE;
  if (v === "true") return true;
  if (v === "false") return false;
  return process.env.NODE_ENV === "production";
}
