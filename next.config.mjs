const isDev = process.env.NODE_ENV !== "production";

// 静的な CSP。Next.js が埋め込むインラインスクリプトと layout.tsx のテーマ初期化
// スクリプトのため script-src に 'unsafe-inline' が要る(nonce 方式は全ページの
// 動的レンダリングが必要になるので見送り)。それでも外部ドメインからのスクリプト読み込み、
// <object>、<base> 書き換え、外部への fetch/送信は塞げる。
// - img-src data:  html5-qrcode が UI アイコンを data URI で持っている
// - media-src blob: QR スキャナーのカメラ映像
// - dev のみ: React の開発ビルドが eval を使い、HMR が WebSocket を使う
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // クリックジャッキング防止: 他サイトからの iframe 埋め込みを全面禁止
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // HTTP で受けた HSTS はブラウザが無視するので、HTTP 運用中は効果も害もない。
  // HTTPS 化したときに自動で効く。サブドメインは巻き込まない。
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
];

const nextConfig = {
  reactStrictMode: true,
  // pdfjs-dist は Node ESM で globalThis に副作用を入れる作りで、
  // RSC バンドルに巻き込むと "Object.defineProperty called on non-object" で
  // 初期化が壊れる。Server External Package として外す。
  serverExternalPackages: ["pdfjs-dist"],
  // html5-qrcode は CommonJS パッケージ。Next.js 15 のデフォルトESM評価で
  // "exports" の解決が崩れることがあるので transpile 対象に含める。
  transpilePackages: ["html5-qrcode"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  // 古いブックマークや `/home` を期待する外部リンクを正規ルート(/today)に吸収。
  // (/today はメインページ。manifest.json の start_url もそちら、 `/` は src/app/page.tsx が直接 redirect 済)
  async redirects() {
    return [
      { source: "/home", destination: "/today", permanent: false },
      { source: "/index", destination: "/today", permanent: false },
    ];
  },
};

export default nextConfig;
