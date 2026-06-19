// /calendar の月ビュー(MonthCalendar)で 1 セルに並べるバーの上限。
//
// サーバー側 (src/lib/indicators.ts getMonthlyEvents) はこの値で
// クエリ結果を切り詰めて RSC payload を抑え、残りは hidden に集約する。
// クライアント側 (src/components/MonthCalendar.tsx) は描画する DOM 数の
// 上限としてそのまま使う。両者が同じ値で動くことが暗黙の前提なので、
// "use client" を含まない中立な lib に置く。
//
// MonthCalendar.tsx 自体は "use client" 宣言ファイルなので、そこに置いた
// constant を server-only パスから import すると Next.js のクライアント
// 参照扱いになり、サーバーコンポーネントのバンドル境界で問題が出る。
export const MAX_BARS_PER_CELL = 3;
