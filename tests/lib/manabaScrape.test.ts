import { describe, expect, it } from "vitest";
import { parseAssignmentsHtml } from "@/lib/manabaScrape";

const row = (type: string, title: string, href: string) =>
  `<tr><td>${type}</td><td><a href="${href}">${title}</a></td><td>コースA</td><td>2026-10-01 00:00</td><td>2026-11-02 23:59</td><td></td></tr>`;

describe("parseAssignmentsHtml", () => {
  it("タイプ列を kind として返し、ドリルは除外する", () => {
    const html = `<table class="stdlist">
      <tr><th>タイプ</th><th>タイトル</th><th>コース</th><th>開始</th><th>終了</th><th>期間</th></tr>
      ${row("アンケート", "授業アンケート", "course_1_survey_2")}
      ${row("レポート", "第1回レポート", "course_1_report_3")}
      ${row("ドリル", "単語ドリル", "course_1_drill_4")}
    </table>`;
    const out = parseAssignmentsHtml(html, "https://cit.manaba.jp");
    expect(out.map((a) => [a.kind, a.title])).toEqual([
      ["アンケート", "授業アンケート"],
      ["レポート", "第1回レポート"],
    ]);
    expect(out[0].url).toBe("https://cit.manaba.jp/ct/course_1_survey_2");
    expect(out[0].dueAt?.toISOString()).toBe("2026-11-02T14:59:00.000Z");
  });
});
