import { fiscalYearOf } from "@/lib/fiscalYear";

/**
 * CIT 同期で削除すべき既存行の id を返す。
 *
 * - 今回のスクレイプ結果に無い行(natural key が一致しない行)が候補。
 * - ただし置き換えるのは今回取得できた学年度の行だけ。ポータルは今年度分しか
 *   返さないので、年度をまたいだ同期で過去年度の時間割を消さないようにする。
 * - effectiveFrom が無い行は年度で守れないので従来どおり置き換え対象。
 */
export function pickStaleClassIds<
  E extends { id: number; effectiveFrom: Date | null },
>(
  existing: E[],
  scraped: { effectiveFrom: Date | null }[],
  isInScrape: (e: E) => boolean,
): number[] {
  const scrapedYears = new Set(
    scraped.flatMap((c) =>
      c.effectiveFrom ? [fiscalYearOf(c.effectiveFrom)] : [],
    ),
  );
  return existing
    .filter((e) => !isInScrape(e))
    .filter(
      (e) =>
        e.effectiveFrom === null ||
        scrapedYears.has(fiscalYearOf(e.effectiveFrom)),
    )
    .map((e) => e.id);
}
