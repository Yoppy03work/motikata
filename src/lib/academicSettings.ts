// 学年歴インポート関連の Setting キー(prisma.setting テーブル経由で永続)。

export const SETTING_KEY_LAST_FETCH = "cit_gakunenreki_last_fetch";

export type CitLastFetch = {
  ts: string;
  academicYear: number;
  inserted: number;
  skipped: number;
};
