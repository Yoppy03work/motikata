/** @type {import('next').NextConfig} */
const securityHeaders = [
  // クリックジャッキング防止: 他サイトからの iframe 埋め込みを全面禁止
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
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
