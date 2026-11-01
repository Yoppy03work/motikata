import { describe, expect, it } from "vitest";
import { parseAssignmentsHtml, parseSubmissionState } from "@/lib/manabaScrape";

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

describe("parseSubmissionState", () => {
  const page = (th: string, td: string, extra = "") =>
    `<html><body>${extra}<table><tr><th class=left>${th}</th><td class=left>${td}</td></tr></table></body></html>`;

  it("小テスト・アンケート形式の提出済み", () => {
    expect(parseSubmissionState(page("状態", "受付終了 <br><strong>提出済み</strong>"))).toBe("submitted");
  });

  it("レポート形式の提出済み(th に空白、div 入り)", () => {
    const td = "<div>受付終了 </div><!-- 確定ボタンを押した後-->\n   提出済み \n <div></div>";
    expect(parseSubmissionState(page("状態     ", td))).toBe("submitted");
  });

  it("未提出", () => {
    expect(
      parseSubmissionState(page("状態", "受付中 <br><span class=deadline>まだ提出していません。</span>")),
    ).toBe("unsubmitted");
    expect(
      parseSubmissionState(page("状態", '<div>受付中</div><strong style="color:red;">まだ提出していません</strong>')),
    ).toBe("unsubmitted");
  });

  it("説明文の「未提出」「提出済」は見ない", () => {
    const extra = "<table><tr><th>課題に関する説明</th><td>レポートが未提出だったり…提出済みの人は</td></tr></table>";
    expect(parseSubmissionState(page("状態", "受付終了 <br><strong>提出済み</strong>", extra))).toBe("submitted");
    expect(parseSubmissionState(page("受付終了日時", "2026-07-17 07:00", extra))).toBe("unknown");
  });

  it("状態欄が無ければ unknown", () => {
    expect(parseSubmissionState("<html><body>ログインしてください</body></html>")).toBe("unknown");
  });
});
