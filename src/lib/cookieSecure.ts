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

// 本番(NODE_ENV=production)で SESSION_COOKIE_SECURE="false" を
// 明示指定していると、Cookie に Secure が付かず HTTPS 環境でも
// HTTP に降格された接続で盗聴できる状態になる。
// HTTP の docker 本番ビルドをローカル運用するためのフラグであり、
// 公開環境にコピペ持ち込まれる事故が一番起きやすい。
// 起動時(モジュール初期化時)に 1 度だけ warn を出して気づきやすくする。
//
// process は import 順に評価されるので、session.ts / login/route.ts いずれが
// 先にこのモジュールを import しても通る。warn は console.warn なので
// Next.js のサーバーログ(stdout/stderr)にそのまま出る。
//
// SESSION_COOKIE_SECURE=true を本番で明示している場合は安全側なので無警告。
// 未指定で NODE_ENV=production なら本関数は true を返すので、これも無警告。
if (
  process.env.NODE_ENV === "production" &&
  process.env.SESSION_COOKIE_SECURE === "false"
) {
  console.warn(
    "[security] SESSION_COOKIE_SECURE=false in production: session/anon cookies will be sent without the Secure flag. This is only safe behind HTTPS-stripping local proxies. Public deployments MUST set true or unset.",
  );
}
