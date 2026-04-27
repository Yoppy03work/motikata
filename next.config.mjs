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
};

export default nextConfig;
