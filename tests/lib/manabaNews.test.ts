import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const { parseCourseList, parseNewsList } = await import("@/lib/manabaScrape");
const { buildNewsMessage } = await import("@/lib/manabaNews");

// 2026-11 時点の manaba の構造を縮めたもの
const cell = (id: number, name: string, news: "on" | "off") => `
  <td class="course course-cell"><div class="courselistweekly-c">
    <a href="course_${id}">${name}</a>
    <a class="courseweekly-fav" href="home_favoritecourse_${id}_set___"><img src="/icon_clip_off.png"></a>
    <div class=coursestatus><img src="/icon_coursenews_${news}.png"><img src="/icon-coursedeadline-off.png"></div>
  </div></td>`;

describe("parseCourseList", () => {
  it("未読ニュースのアイコンを読み、時間割で重複するコースを 1 つにまとめる", () => {
    const html = `<table><tr>${cell(1, "データベース", "on")}${cell(2, "応用解析", "off")}</tr>
      <tr>${cell(1, "データベース", "off")}${cell(2, "応用解析", "off")}</tr></table>`;
    expect(parseCourseList(html)).toEqual([
      { courseId: 1, name: "データベース", hasUnreadNews: true },
      { courseId: 2, name: "応用解析", hasUnreadNews: false },
    ]);
  });

  it("アイコンが無い表示形式では null", () => {
    expect(parseCourseList(`<ul><li><a href="course_3">経済学</a></li></ul>`)).toEqual([
      { courseId: 3, name: "経済学", hasUnreadNews: null },
    ]);
  });
});

describe("parseNewsList", () => {
  const html = `<table class=stdlist width="100%">
    <tr class=title><th>タイトル</th><th>投稿者</th><th>公開日時</th></tr>
    <tr class="row1"><td class="newstext unread "><a href="course_9_news_100">中間試験 の部屋割り</a></td>
      <td><a href="course_"></a>&nbsp;<a href="#">白木 詩乃</a></td><td class="center"> 2026-10-29 11:05 </td></tr>
    <tr class="row0"><td class="newstext "><a href="course_9_news_99">第2回について</a></td>
      <td><a href="#">白木 詩乃</a></td><td class="center"> 2026-09-28 17:04 </td></tr>
    <tr><td class="newstext"><a href="course_8_news_1">別コースのリンク</a></td><td></td><td>2026-09-01 10:00</td></tr>
  </table>`;

  it("タイトル・投稿者・公開日時(JST)・未読を読む", () => {
    const items = parseNewsList(html, "https://cit.manaba.jp", 9);
    expect(items).toEqual([
      {
        newsId: 100,
        courseId: 9,
        title: "中間試験 の部屋割り",
        author: "白木 詩乃",
        publishedAt: new Date("2026-10-29T02:05:00.000Z"),
        url: "https://cit.manaba.jp/ct/course_9_news_100",
        unread: true,
      },
      expect.objectContaining({ newsId: 99, unread: false }),
    ]);
  });
});

describe("buildNewsMessage", () => {
  const n = (title: string, h: number) => ({
    courseName: "データベース",
    title,
    author: "白木 詩乃",
    publishedAt: new Date(Date.UTC(2026, 9, 29, h)),
  });

  it("1 件ならコース名とタイトルをそのまま題名にする", () => {
    expect(buildNewsMessage([n("部屋割り", 2)])).toMatchObject({
      title: "【データベース】部屋割り",
      body: "manaba のコースニュース(白木 詩乃・10/29 11:00)",
      url: "/news",
    });
  });

  it("複数なら件数を題名にし、新しい順に並べる", () => {
    const msg = buildNewsMessage([n("古い", 1), n("新しい", 3)]);
    expect(msg?.title).toBe("manaba のコースニュースが 2 件あります");
    expect(msg?.body).toBe("・【データベース】新しい\n・【データベース】古い");
  });

  it("0 件なら送らない", () => {
    expect(buildNewsMessage([])).toBeNull();
  });
});
