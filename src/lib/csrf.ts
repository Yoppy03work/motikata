// 状態変更リクエストの CSRF 対策。
// SameSite=Lax の Cookie だけに頼らず、Origin/Referer が自サイトかを検証する。
//
// APP_ORIGIN はカンマ区切りで複数指定可。未設定なら host ヘッダから自サイトを再構成し、
// 同一オリジンのみを許可する(ローカル開発では通常これで十分)。

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedOrigins(req: Request): string[] {
  const env = process.env.APP_ORIGIN;
  const list = env
    ? env.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (list.length > 0) return list;

  // フォールバック: 自サイト origin を host から再構成
  const host = req.headers.get("host");
  if (!host) return [];
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return [`${proto}://${host}`];
}

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function isSameOrigin(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return true;

  const allowed = allowedOrigins(req);
  if (allowed.length === 0) return false;

  const origin = normalizeOrigin(req.headers.get("origin"));
  if (origin) return allowed.includes(origin);

  // 一部のクライアントは Origin を付けないため Referer でフォールバック
  const referer = normalizeOrigin(req.headers.get("referer"));
  if (referer) return allowed.includes(referer);

  return false;
}
